// daemon.mjs — L3 adapter: Unix socket for hook fast path + process management.
// Engine stays warm in memory. main.mjs hook mode connects via socket instead of cold start.
//
// Protocol: newline-delimited JSON over Unix socket.
//   Client sends: { event JSON }
//   Server responds: { response JSON } or empty line (no match)
//
// Lifecycle: start → pidfile + socket → accept connections → stop on SIGTERM/SIGINT
// Config: runtime.schema.json ProcessConfig (pidFile, socketPath, logFile)

import { createServer } from 'node:net'
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { ObjectTree } from '../lib/schema2object.mjs'

// Default paths (match ProcessConfig defaults in runtime.schema.json)
const DEFAULTS = { pidFile: 'run/hook.pid', socketPath: 'run/hook.sock' }

function resolvePaths(projectRoot, processConfig) {
  const cfg = processConfig || {}
  return {
    socketPath: resolve(projectRoot, cfg.socketPath || DEFAULTS.socketPath),
    pidPath: resolve(projectRoot, cfg.pidFile || DEFAULTS.pidFile)
  }
}

function busLog(bus, level, msg, extra = {}) {
  if (bus) bus.send('log', { ts: Date.now(), level, message: msg, event: 'daemon', ...extra }).catch(() => {})
}

export function startDaemon(core, { projectRoot, processConfig }) {
  const { socketPath, pidPath } = resolvePaths(projectRoot, processConfig)
  const bus = core.bus
  const loader = core.hooksLoader || null

  mkdirSync(dirname(socketPath), { recursive: true })
  mkdirSync(dirname(pidPath), { recursive: true })

  // Kill existing daemon before starting (prevent orphans)
  if (existsSync(pidPath)) {
    const oldPid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10)
    if (oldPid && oldPid !== process.pid) {
      try { process.kill(oldPid, 'SIGTERM') } catch {}
      busLog(bus, 'warn', `killed previous daemon pid=${oldPid}`)
    }
  }

  // Clean stale socket
  if (existsSync(socketPath)) {
    try { unlinkSync(socketPath) } catch {}
  }

  // Write pidfile
  writeFileSync(pidPath, String(process.pid) + '\n')

  // Build ObjectTree from event input — validates + becomes the live object for pipeline
  function _buildEventTree(msg) {
    if (typeof msg !== 'object' || msg === null) return { error: 'message is not an object' }

    // JSON-RPC: pass through to core.handle (has its own validation)
    if (msg.jsonrpc === '2.0') return { type: 'jsonrpc', data: msg }

    // Log forwarding: minimal shape check
    if (msg._log === true) {
      if (typeof msg.level !== 'string') return { error: '_log: level must be string' }
      return { type: 'log', data: msg }
    }

    // Hook event: validate via event input schema → ObjectTree
    const eventName = msg.hook_event_name
    if (!eventName || typeof eventName !== 'string') return { error: 'hook_event_name must be non-empty string' }

    if (loader) {
      try {
        const resolved = loader.resolve(`hooks/${eventName}.json`)
        const schema = resolved.node || resolved
        const inputSchema = schema.definitions?.event || schema
        const tree = new ObjectTree(msg, inputSchema, loader)
        return { type: 'event', data: tree }
      } catch (e) {
        // Schema validation failed — log but pass raw (forward compat with new fields)
        busLog(bus, 'debug', `event validation fallback: ${eventName} ${e.message}`)
        return { type: 'event', data: msg }
      }
    }

    // No loader (fallback) — pass raw
    return { type: 'event', data: msg }
  }

  const server = createServer((conn) => {
    let buffer = ''

    conn.on('data', (chunk) => {
      buffer += chunk.toString()
      let nl
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue

        try {
          const msg = JSON.parse(line)
          const parsed = _buildEventTree(msg)

          if (parsed.error) {
            busLog(bus, 'warn', `invalid input: ${parsed.error}`)
            conn.write(JSON.stringify({ error: parsed.error }) + '\n')
            continue
          }

          if (parsed.type === 'jsonrpc') {
            core.handle(parsed.data).then(res => {
              conn.write(JSON.stringify(res) + '\n')
            }).catch(e => {
              busLog(bus, 'error', `JSON-RPC handle failed: ${e.message}`, { error: e.message, stack: e.stack })
              conn.write(JSON.stringify({ jsonrpc: '2.0', id: parsed.data.id, error: { code: -32603, message: e.message } }) + '\n')
            })
          } else if (parsed.type === 'log') {
            const { _log, ...payload } = parsed.data
            core.bus.send('log', payload).catch(() => {})
            conn.write('\n')
          } else {
            // Hook event — parsed.data is ObjectTree (or raw fallback)
            core.bus.send('hooks:process-event', parsed.data).then(response => {
              conn.write(response ? JSON.stringify(response) + '\n' : '\n')
            }).catch(e => {
              busLog(bus, 'error', `hooks:process-event failed: ${e.message}`, { error: e.message, stack: e.stack })
              conn.write(JSON.stringify({ error: e.message }) + '\n')
            })
          }
        } catch (e) {
          busLog(bus, 'error', `JSON parse error: ${e.message}`, { error: e.message, stack: e.stack })
          conn.write(JSON.stringify({ error: e.message }) + '\n')
        }
      }
    })

    conn.on('error', (e) => { busLog(bus, 'warn', `client connection error: ${e.message}`) })
  })

  server.listen(socketPath, () => {
    busLog(bus, 'info', `Daemon listening on ${socketPath} (pid ${process.pid})`)
  })

  server.on('error', (e) => {
    busLog(bus, 'error', `Daemon server error: ${e.message}`)
    process.exit(1)
  })

  function shutdown() {
    busLog(bus, 'info', 'Daemon shutting down')
    server.close()
    try { unlinkSync(socketPath) } catch {}
    try { unlinkSync(pidPath) } catch {}
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGHUP', () => {
    bus.send('engine:reload').then(() => {
      busLog(bus, 'info', 'Rules reloaded via SIGHUP')
    }).catch(e => {
      busLog(bus, 'error', `SIGHUP reload failed: ${e.message}`)
    })
  })

  return { server, socketPath, pidPath, shutdown }
}

// --- Client: connect to daemon socket ---

export function connectDaemon(projectRoot, processConfig) {
  const { socketPath, pidPath } = resolvePaths(projectRoot, processConfig)

  if (!existsSync(socketPath) || !existsSync(pidPath)) return null

  const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10)
  if (!pid) return null
  try { process.kill(pid, 0) } catch { return null }

  return {
    socketPath,
    pid,
    async processEvent(event) {
      const { createConnection } = await import('node:net')
      return new Promise((resolve, reject) => {
        const conn = createConnection(socketPath)
        let buffer = ''
        const timeout = setTimeout(() => {
          conn.destroy()
          reject(new Error('daemon timeout'))
        }, 3000)

        conn.on('connect', () => {
          conn.write(JSON.stringify(event) + '\n')
        })

        conn.on('data', (chunk) => {
          buffer += chunk.toString()
          const nl = buffer.indexOf('\n')
          if (nl !== -1) {
            clearTimeout(timeout)
            const line = buffer.slice(0, nl).trim()
            conn.destroy()
            if (!line) { resolve(null); return }
            try { resolve(JSON.parse(line)) }
            catch (e) { reject(e) }
          }
        })

        conn.on('error', (e) => {
          clearTimeout(timeout)
          reject(e)
        })
      })
    }
  }
}

// --- Control: stop/status ---

export function daemonStatus(projectRoot, processConfig) {
  const { socketPath, pidPath } = resolvePaths(projectRoot, processConfig)

  if (!existsSync(pidPath)) return { running: false }

  const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10)
  if (!pid) return { running: false }

  try {
    process.kill(pid, 0)
    return { running: true, pid, socket: socketPath }
  } catch {
    try { unlinkSync(pidPath) } catch {}
    try { unlinkSync(socketPath) } catch {}
    return { running: false, stale: true }
  }
}

export function daemonStop(projectRoot, processConfig) {
  const status = daemonStatus(projectRoot, processConfig)
  if (!status.running) return { stopped: false, reason: 'not running' }

  try {
    process.kill(status.pid, 'SIGTERM')
    return { stopped: true, pid: status.pid }
  } catch (e) {
    return { stopped: false, reason: e.message }
  }
}

export function reloadDaemon(projectRoot, processConfig) {
  const status = daemonStatus(projectRoot, processConfig)
  if (!status.running) return { reloaded: false, reason: 'not running' }

  try {
    process.kill(status.pid, 'SIGHUP')
    return { reloaded: true, pid: status.pid }
  } catch (e) {
    return { reloaded: false, reason: e.message }
  }
}
