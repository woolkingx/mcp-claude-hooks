// Structured logger — dual sink: log file (text) + console (stderr)
// Six-level severity: trace(0) < debug(1) < info(2) < warn(3) < error(4) < fatal(5)
// File: logs/hook.log — rotates to hook.YYYY-MM-DD.log at midnight, purges old files.
// debug/trace records payload input/output snapshots (truncated at payloadMaxBytes)
// All config from runtime.schema.json LogConfig.
// Unified level override: MCP_HOOKS_LOG_LEVEL env var sets both file + console level.

import { appendFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { LOG_FILENAME, todayTag, rotateIfNeeded } from '../foundation/log-file.mjs'

const LEVELS = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 }
const COLORS = {
  trace: '\x1b[90m', debug: '\x1b[36m', info: '\x1b[32m',
  warn: '\x1b[33m',  error: '\x1b[31m', fatal: '\x1b[35;1m', reset: '\x1b[0m'
}

export function createLogger(bus, logConfig) {
  const logDir     = logConfig.logDir || null
  const consoleCfg = logConfig.console || {}
  let fileLevel      = logConfig.level || 'info'
  let consoleEnabled = consoleCfg.enabled ?? false
  let consoleLevel   = consoleCfg.level || 'info'
  const useColor     = (consoleCfg.color ?? true) && process.stderr.isTTY
  const showTs       = consoleCfg.timestamps ?? true
  const payloadMax   = logConfig.payloadMaxBytes || 4096
  const logPurgeMs   = logConfig.logPurgeMs || 300000
  const maxTracked   = logConfig.maxTrackedRequests || 100
  const requests     = new Map()
  const retentionCfg = logConfig.retention || {}
  const maxDays      = retentionCfg.maxDays ?? 7

  // Track current day for rotation
  let currentDay = todayTag()
  // Rotate on startup if day changed since last run
  if (logDir) currentDay = rotateIfNeeded(logDir, currentDay)

  // --- helpers ---

  function passes(entryLevel, threshold) {
    return (LEVELS[entryLevel] ?? 2) >= (LEVELS[threshold] ?? 2)
  }

  function shouldSnapshot(entryLevel) {
    return (LEVELS[entryLevel] ?? 2) <= LEVELS.debug
  }

  function snapshot(data) {
    if (data == null) return null
    try {
      const s = JSON.stringify(data)
      return s.length <= payloadMax ? data : s.slice(0, payloadMax) + '...[truncated]'
    } catch { return '[circular/unserializable]' }
  }

  function dayLogPath() {
    if (!logDir) return null
    return join(logDir, LOG_FILENAME)
  }

  // --- retention: purge old daily files ---

  function purgeOldLogs() {
    if (!logDir || !existsSync(logDir)) return
    try {
      const cutoff = Date.now() - maxDays * 86400000
      for (const f of readdirSync(logDir)) {
        const m = f.match(/^hook\.(\d{4}-\d{2}-\d{2})\.log$/)
        if (!m) continue
        const fileDate = new Date(m[1] + 'T00:00:00Z').getTime()
        if (fileDate < cutoff) {
          try { unlinkSync(join(logDir, f)) } catch {}
        }
      }
    } catch {}
  }

  // Purge on startup, then daily via day check
  purgeOldLogs()

  // --- sinks ---

  function writeFile(record) {
    if (!logDir) return
    if (!passes(record.level || 'info', fileLevel)) return

    // Day rotation: rename hook.log → hook.YYYY-MM-DD.log + purge old
    const today = todayTag()
    if (today !== currentDay) {
      currentDay = rotateIfNeeded(logDir, currentDay)
      purgeOldLogs()
    }

    try {
      const ts = new Date(record.ts || Date.now()).toISOString()
      const lvl = (record.level || 'info').toUpperCase().padEnd(5)
      const evt = record.event || ''
      const msg = record.message || ''
      const dur = record.duration != null ? ` ${record.duration}ms` : ''
      const err = record.error ? ` err=${record.error}` : ''
      const stk = record.stack ? `\n  ${record.stack}` : ''
      const st = record.status ? ` [${record.status}]` : ''
      const req     = record.reqId   ? ` ${record.reqId}` : ''
      const matched = record.matched ? ` matched=${JSON.stringify(record.matched)}` : ''
      const action  = record.action  ? ` action=${record.action}` : ''
      let line = `${ts} ${lvl} ${evt}${st}${req}${dur}${matched}${action}${msg ? ' ' + msg : ''}${err}${stk}\n`
      // debug/trace: append input/output snapshot to file
      if (record.input != null) {
        line += `  input: ${typeof record.input === 'string' ? record.input : JSON.stringify(record.input)}\n`
      }
      if (record.output != null) {
        line += `  output: ${typeof record.output === 'string' ? record.output : JSON.stringify(record.output)}\n`
      }
      appendFileSync(dayLogPath(), line)
    } catch (e) {
      try { process.stderr.write(`[log-write-err] ${e.message}\n`) } catch {}
    }
  }

  function writeConsole(record) {
    if (!consoleEnabled) return
    if (!passes(record.level || 'info', consoleLevel)) return
    const lvl = (record.level || 'info').toUpperCase().padEnd(5)
    const ts  = showTs ? new Date(record.ts || Date.now()).toISOString() + ' ' : ''
    const evt = record.event || ''
    const msg = record.message || record.msg || ''
    const err = record.error ? ` err=${record.error}` : ''
    const dur = record.duration != null ? ` ${record.duration}ms` : ''
    const st  = record.status ? ` [${record.status}]` : ''

    let line
    if (useColor) {
      const c = COLORS[record.level] || COLORS.info
      line = `${c}[${lvl}]${COLORS.reset} ${ts}${evt}${st}${dur}${msg ? ' ' + msg : ''}${err}\n`
    } else {
      line = `[${lvl}] ${ts}${evt}${st}${dur}${msg ? ' ' + msg : ''}${err}\n`
    }

    if (record.input != null)  line += `  input: ${typeof record.input === 'string' ? record.input : JSON.stringify(record.input)}\n`
    if (record.output != null) line += `  output: ${typeof record.output === 'string' ? record.output : JSON.stringify(record.output)}\n`

    try { process.stderr.write(line) } catch { /* EPIPE — stderr closed, ignore */ }
  }

  function write(record) {
    writeFile(record)
    writeConsole(record)
  }

  // --- bus.handle('log') — application log from engine/daemon/features ---

  bus.handle('log', (msg) => {
    try {
      const ts = msg.ts || Date.now()
      const entryLevel = (typeof msg.level === 'string' && LEVELS[msg.level] !== undefined)
        ? msg.level : 'info'

      // Request tracking (for per-request summary)
      const reqId = msg.reqId
      if (reqId) {
        if (!requests.has(reqId)) requests.set(reqId, { ts, events: [], method: null, tool: null })
        const req = requests.get(reqId)
        req.events.push({ event: msg.event, status: msg.status, duration: msg.duration, error: msg.error })
        if (msg.event === 'validate' && msg.payload?.method) req.method = msg.payload.method
        if (msg.event === 'dispatch' && msg.payload?.name)   req.tool   = msg.payload.name

        if (msg.event === 'route') {
          const total  = Date.now() - req.ts
          const parts  = req.events.map(e => `${e.event}:${e.duration ?? '?'}ms${e.error ? '!' : ''}`).join(' ')
          const label  = req.tool ? `${req.method} ${req.tool}` : req.method || '?'
          const symbol = msg.status === 'completed' ? '→' : '✗'
          write({ ts: Date.now(), level: 'info', event: 'request:summary',
            message: `${reqId} ${label} ${symbol} ${total}ms [${parts}]` })
          requests.delete(reqId)
        }

        if (requests.size > maxTracked) {
          const cutoff = Date.now() - logPurgeMs
          for (const [id, r] of requests) { if (r.ts < cutoff) requests.delete(id) }
        }
      }

      const record = {
        ts, level: entryLevel,
        event:   msg.event   || 'log',
        message: msg.message || msg.msg || null,
        status:  msg.status  || null,
        error:   msg.error   != null ? String(msg.error) : null,
        stack:   msg.stack   || null,
        duration: msg.duration ?? null,
        reqId:   reqId || null,
        matched: msg.matched  || null,
        action:  msg.action   || null,
      }
      const snap = shouldSnapshot(entryLevel)
      if (snap && msg.input  !== undefined) record.input  = snapshot(msg.input)
      if (snap && msg.output !== undefined) record.output = snapshot(msg.output)
      write(record)
    } catch (e) {
      try { process.stderr.write(`[log-handler-err] ${e.message}\n`) } catch {}
    }
  })

  // --- fatal process handlers ---

  function onUncaught(err) {
    const record = { ts: Date.now(), level: 'fatal', event: 'process:uncaught',
      message: err?.message || String(err), error: String(err), stack: err?.stack || null }
    writeFile(record)
    writeConsole(record)
    process.exit(1)
  }

  function onUnhandledRejection(reason) {
    const e = reason instanceof Error ? reason : new Error(String(reason))
    const record = { ts: Date.now(), level: 'fatal', event: 'process:unhandled-rejection',
      message: e.message, error: String(e), stack: e.stack || null }
    writeFile(record)
    writeConsole(record)
    process.exit(1)
  }

  process.on('uncaughtException', onUncaught)
  process.on('unhandledRejection', onUnhandledRejection)

  function setLevel(newLevel, sink = 'all') {
    if (LEVELS[newLevel] === undefined) throw new Error(`invalid log level: ${newLevel}`)
    if (sink === 'file' || sink === 'all') fileLevel = newLevel
    if (sink === 'console' || sink === 'all') consoleLevel = newLevel
    return { fileLevel, consoleLevel }
  }

  function teardown() {
    process.off('uncaughtException', onUncaught)
    process.off('unhandledRejection', onUnhandledRejection)
    requests.clear()
  }

  return { setLevel, teardown }
}
