// Streamable HTTP transport — MCP spec 2025-03-26
// Single endpoint: POST (JSON-RPC), GET (SSE stream), DELETE (session terminate)
// All config from transport.schema.json via runtime.

import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

function sseLog(bus, level, message, extra = {}) {
  if (bus) bus.send('log', { ts: Date.now(), level, event: 'sse', message, ...extra }).catch(() => {})
}

export function startSSE(core, transportConfig, errorCodes) {
  const { port, host, endpoint, session: sessionCfg, sse: sseCfg, cors: corsCfg, http: httpCfg } = transportConfig
  const { bus } = core

  // Session store: sessionId → { streams: Set<res> }
  const sessions = new Map()

  function generateSessionId() {
    return randomBytes(sessionCfg.idLength / 2).toString('hex')
  }

  function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', corsCfg.allowOrigin)
    res.setHeader('Access-Control-Allow-Methods', corsCfg.allowMethods)
    res.setHeader('Access-Control-Allow-Headers', corsCfg.allowHeaders)
    if (corsCfg.exposeHeaders) res.setHeader('Access-Control-Expose-Headers', corsCfg.exposeHeaders)
  }

  function sseWrite(res, data, eventId) {
    if (eventId) res.write(`id: ${eventId}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  function ssePrime(res) {
    res.write(`retry: ${sseCfg.retryMs}\n`)
    res.write(`data: \n\n`)
  }

  function isRequest(msg) {
    return msg.method && msg.id !== undefined
  }

  function isNotificationOrResponse(msg) {
    return !isRequest(msg)
  }

  function getSession(req) {
    const id = req.headers['mcp-session-id']
    if (!id) return null
    return sessions.get(id) || null
  }

  const server = createServer(async (req, res) => {
    setCors(res)

    // Parse URL path
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    if (url.pathname !== endpoint) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    // OPTIONS — CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // DELETE — terminate session
    if (req.method === 'DELETE') {
      if (!sessionCfg.enabled) {
        res.writeHead(405)
        res.end('Method not allowed')
        return
      }
      const sessionId = req.headers['mcp-session-id']
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(404)
        res.end('Session not found')
        return
      }
      const session = sessions.get(sessionId)
      for (const stream of session.streams) {
        stream.end()
      }
      sessions.delete(sessionId)
      sseLog(bus, 'info', `session deleted: ${sessionId}`)
      res.writeHead(204)
      res.end()
      return
    }

    // GET — open SSE stream for server-initiated messages
    if (req.method === 'GET') {
      const accept = req.headers['accept'] || ''
      if (!accept.includes('text/event-stream')) {
        res.writeHead(406)
        res.end('Accept must include text/event-stream')
        return
      }

      if (sessionCfg.enabled) {
        const session = getSession(req)
        if (!session) {
          res.writeHead(400)
          res.end('Missing or invalid Mcp-Session-Id')
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' })
        ssePrime(res)
        session.streams.add(res)
        req.on('close', () => session.streams.delete(res))
      } else {
        res.writeHead(405)
        res.end('Method not allowed')
      }
      return
    }

    // POST — JSON-RPC message
    if (req.method === 'POST') {
      const chunks = []
      let totalBytes = 0
      for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        totalBytes += buf.length
        if (totalBytes > httpCfg.maxBodySize) {
          res.writeHead(413)
          res.end('Payload too large')
          return
        }
        chunks.push(buf)
      }

      let message
      try {
        message = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          jsonrpc: '2.0', id: null,
          error: { code: errorCodes.PARSE_ERROR, message: 'Parse error' }
        }))
        return
      }

      // Session validation (except initialize)
      if (sessionCfg.enabled && message.method !== 'initialize') {
        const session = getSession(req)
        if (!session) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            jsonrpc: '2.0', id: message.id || null,
            error: { code: errorCodes.INVALID_REQUEST, message: 'Missing or invalid Mcp-Session-Id' }
          }))
          return
        }
      }

      // Notification or response → 202 Accepted
      if (isNotificationOrResponse(message) && message.method !== 'initialize') {
        await core.handle(message)
        res.writeHead(202)
        res.end()
        return
      }

      // Request → handle and respond
      const accept = req.headers['accept'] || ''
      const response = await core.handle(message)

      // Initialize → create session, attach Mcp-Session-Id
      if (message.method === 'initialize' && sessionCfg.enabled && response?.result) {
        const sessionId = generateSessionId()
        sessions.set(sessionId, { streams: new Set() })
        sseLog(bus, 'info', `session created: ${sessionId}`)
        const headers = { 'Content-Type': 'application/json', 'Mcp-Session-Id': sessionId }
        res.writeHead(200, headers)
        res.end(response ? JSON.stringify(response) : '')
        return
      }

      // SSE stream response if client accepts it
      if (accept.includes('text/event-stream')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' })
        ssePrime(res)
        if (response) sseWrite(res, response)
        res.end()
      } else {
        // Plain JSON response
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(response ? JSON.stringify(response) : '')
      }
      return
    }

    // Unsupported method
    res.writeHead(405)
    res.end('Method not allowed')
  })

  // Keepalive for SSE streams
  const keepAliveInterval = setInterval(() => {
    for (const session of sessions.values()) {
      for (const stream of session.streams) {
        stream.write(': keepalive\n\n')
      }
    }
  }, sseCfg.keepAliveMs)

  server.on('error', (e) => {
    sseLog(bus, 'error', `server error: ${e.message}`, { error: e.message, stack: e.stack })
  })

  server.listen(port, host, () => {
    sseLog(bus, 'info', `listening on ${host}:${port}${endpoint}`)
  })

  // Cleanup on lifecycle stop
  server.on('close', () => clearInterval(keepAliveInterval))
}
