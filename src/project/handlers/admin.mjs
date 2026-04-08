// admin.mjs — System administration: config, check, status, reload, restart, pause, resume, schema, logs, analytics
// Handlers follow (input, ctx) signature — ctx provides runtime, bus, lifecycle, configDir.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Loader, ObjectTree } from '../../lib/schema2object.mjs'
import { LOG_FILENAME } from '../../foundation/log-file.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..')

function getHooksDir() {
  return resolve(PROJECT_ROOT, 'src', 'project', 'config', 'hooks')
}

function listEventFiles() {
  const dir = getHooksDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'base.schema.json').map(f => f.replace('.json', '')).sort()
}

// --- Actions ---

// Derive readonly/internal sections from schema x-readonly / x-internal annotations
function _schemaAnnotatedSections(ctx, annotation) {
  const props = ctx.schemas?.runtime?.properties
  if (!props) return new Set()
  return new Set(Object.entries(props).filter(([, v]) => v[annotation]).map(([k]) => k))
}

function config({ section, key, set_value }, ctx) {
  const rt = ctx.runtime
  if (!rt) return { error: 'Runtime not available (hook mode has no MCP context)' }

  // SET mode: section + key + set_value
  if (key !== undefined && set_value !== undefined) {
    if (!section || section === 'all') throw new Error('Specify a section to set (e.g. log, output)')
    const readonlySections = _schemaAnnotatedSections(ctx, 'x-readonly')
    if (readonlySections.has(section)) throw new Error(`Section "${section}" is read-only (requires restart)`)
    if (rt[section] === undefined) throw new Error(`Unknown section: ${section}`)

    const prev = rt[section][key]
    rt[section][key] = set_value  // ObjectTree validates on write
    return { set: true, section, key, value: set_value, previous: prev }
  }

  // GET mode
  if (section === 'all') return rt.$toDict()
  if (rt[section] === undefined) {
    const available = Object.keys(rt.$toDict()).join(', ')
    throw new Error(`Unknown config section: ${section}. Available: ${available}`)
  }
  return { [section]: rt[section] }
}

function check({ verbose }, ctx) {
  const rt = ctx.runtime
  if (!rt) return { error: 'Runtime not available (hook mode has no MCP context)' }
  const internalSections = _schemaAnnotatedSections(ctx, 'x-internal')
  const readonlySections = _schemaAnnotatedSections(ctx, 'x-readonly')
  const skipSections = new Set([...internalSections, ...readonlySections])
  const sections = Object.keys(rt.$toDict()).filter(k => !skipSections.has(k))
  const results = []
  let pass = true

  for (const name of sections) {
    const value = rt[name]
    const ok = value !== undefined && value !== null
    if (!ok) pass = false
    const entry = { section: name, status: ok ? 'ok' : 'missing' }
    if (verbose && ok) entry.defaults = value
    results.push(entry)
  }

  return { pass, results }
}

async function status(_input, ctx) {
  const events = listEventFiles()
  const ruleCounts = {}
  if (ctx.bus) {
    try {
      const res = await ctx.bus.send('hooks_rules:list', {})
      const allRules = res?.rules || []
      for (const r of allRules) {
        if (events.includes(r.event)) {
          ruleCounts[r.event] = (ruleCounts[r.event] || 0) + 1
        }
      }
    } catch { /* bus unavailable — leave ruleCounts empty */ }
  }

  const result = {
    server: 'mcp-claude-hooks',
    paused: _isPaused(),
    events_supported: events.length,
    rules_active: Object.values(ruleCounts).reduce((a, b) => a + b, 0),
    rules_by_event: ruleCounts
  }

  // Bus stats (MCP server mode)
  if (ctx.bus?.stats) {
    const bs = ctx.bus.stats()
    result.requests = bs.requests
    result.messages = bs.messages
    result.handlers = bs.handlers
  }

  // Lifecycle uptime (MCP server mode)
  if (ctx.lifecycle?.getStartedAt) {
    const uptimeMs = Date.now() - ctx.lifecycle.getStartedAt()
    const uptimeSec = Math.floor(uptimeMs / 1000)
    const h = Math.floor(uptimeSec / 3600)
    const m = Math.floor((uptimeSec % 3600) / 60)
    const s = uptimeSec % 60
    result.uptime = `${h}h ${m}m ${s}s`
    result.uptimeMs = uptimeMs
    result.state = ctx.lifecycle.getState()
  }

  return result
}

async function reload(_input, ctx) {
  // Composition: reload engine match data + handler cache via bus.send
  // Same path whether triggered by MCP tool, CLI, rules:changed, or SIGHUP
  await ctx.bus.send('engine:reload')
  await ctx.bus.send('hooks_rules:reload', {})

  // Reload runtime overrides from file if exists
  let configReloaded = false
  const overridesFile = resolve(PROJECT_ROOT, 'config', 'runtime.json')
  if (ctx.runtime && existsSync(overridesFile)) {
    try {
      const overrides = JSON.parse(readFileSync(overridesFile, 'utf-8'))
      const readonlySections = _schemaAnnotatedSections(ctx, 'x-readonly')
      for (const [section, values] of Object.entries(overrides)) {
        if (readonlySections.has(section)) continue
        if (ctx.runtime[section] === undefined) continue
        for (const [key, val] of Object.entries(values)) {
          ctx.runtime[section][key] = val
        }
      }
      configReloaded = true
    } catch (e) {
      return { reloaded: true, configError: e.message }
    }
  }

  // Notify client that tools may have changed
  if (ctx.transport) {
    process.stdout.write(JSON.stringify(ctx.transport.notifyToolsChanged()) + '\n')
  }

  const events = listEventFiles()
  let preToolUseCount = 0
  if (ctx.bus) {
    try {
      const res = await ctx.bus.send('hooks_rules:list', { event_type: 'PreToolUse' })
      preToolUseCount = res?.count ?? 0
    } catch { /* leave 0 */ }
  }
  return { reloaded: true, configReloaded, events: events.length, rules: preToolUseCount }
}

function schema({ file, definition, data, event }, ctx) {
  // Legacy: event-only mode (backward compat)
  if (event && !file) {
    const dir = getHooksDir()
    const filePath = join(dir, `${event}.json`)
    if (!existsSync(filePath)) return { error: `No schema for event: ${event}`, available: listEventFiles() }
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  }

  // Generic schema inspector
  const configDir = ctx.configDir || resolve(PROJECT_ROOT, 'src', 'project', 'config')
  const schemaText = readFileSync(join(configDir, file), 'utf8')
  const schemaDoc = JSON.parse(schemaText)

  if (!definition) {
    const defs = schemaDoc.definitions || {}
    const list = Object.entries(defs).map(([name, def]) => ({
      name, type: def.type || '(composite)', description: def.description || ''
    }))
    return { file, definitions: list }
  }

  const def = schemaDoc.definitions?.[definition]
  if (!def) {
    const available = Object.keys(schemaDoc.definitions || {}).join(', ')
    throw new Error(`Definition "${definition}" not found in ${file}. Available: ${available}`)
  }

  const result = { file, definition, schema: def }
  if (data !== undefined) {
    const loader = new Loader(schemaDoc, configDir)
    try {
      new ObjectTree(data, def, loader)
      result.validation = { valid: true }
    } catch (e) {
      result.validation = { valid: false, error: e.message }
    }
  }
  return result
}

function resolveLogFile(ctx) {
  const logDir = ctx.runtime?.log?.logDir
  if (!logDir) return null
  const absDir = resolve(PROJECT_ROOT, logDir)
  return join(absDir, LOG_FILENAME)
}

function logs({ level, limit }, ctx) {
  const logFile = resolveLogFile(ctx)
  if (!logFile || !existsSync(logFile)) {
    return { entries: [], message: 'No log file yet. Logs appear after hook processing.' }
  }

  const max = limit || 50
  const lines = readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean)

  // Text format: "ISO LEVEL source [status] reqId dur matched=[] action= msg err"
  let entries = []
  for (let i = lines.length - 1; i >= 0 && entries.length < max; i--) {
    const line = lines[i]
    const m = line.match(/^(\S+)\s+(\w+)\s+(.*)$/)
    if (!m) continue
    const [, ts, lvl, rest] = m
    if (level && lvl.trim().toLowerCase() !== level.toLowerCase()) continue
    entries.push({ ts, level: lvl.trim().toLowerCase(), message: rest })
  }

  return { total_lines: lines.length, returned: entries.length, filter: level || 'all', entries }
}

function analytics({ rule: filterRule, event: filterEvent, limit }, ctx) {
  const logFile = resolveLogFile(ctx)
  if (!logFile || !existsSync(logFile)) return { message: 'No log file yet.' }

  const lines = readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean)
  const max = limit || lines.length
  const ruleStats = {}
  let processed = 0

  // Log format: "ISO INFO  engine {event} {tool} [{inputHint}]: {name}:{action}, ... {dur}ms"
  const engineRe = /INFO\s+engine\s+(\S+)\s+\S+.*?:\s+(.+?)\s+(\d+)ms\s*$/
  for (let i = lines.length - 1; i >= 0 && processed < max; i--) {
    const line = lines[i]
    const m = line.match(engineRe)
    if (!m) continue
    const [, event, rulesStr, durStr] = m
    if (filterEvent && event !== filterEvent) continue
    if (rulesStr === '-') continue  // pass-through, no rules matched
    const duration = parseInt(durStr)
    processed++
    for (const part of rulesStr.split(',')) {
      const p = part.trim()
      const colonIdx = p.lastIndexOf(':')
      const name = colonIdx >= 0 ? p.slice(0, colonIdx) : p
      const action = colonIdx >= 0 ? p.slice(colonIdx + 1) : 'unknown'
      if (!name) continue
      if (filterRule && name !== filterRule) continue
      if (!ruleStats[name]) ruleStats[name] = { count: 0, deny: 0, allow: 0, context: 0, ask: 0, durations: [] }
      const s = ruleStats[name]
      s.count++
      if (action) s[action] = (s[action] || 0) + 1
      s.durations.push(duration)
    }
  }

  const results = Object.entries(ruleStats).map(([name, s]) => {
    const avg_ms = s.durations.length ? Math.round(s.durations.reduce((a, b) => a + b, 0) / s.durations.length) : null
    const p95_ms = s.durations.length >= 5
      ? s.durations.sort((a, b) => a - b)[Math.floor(s.durations.length * 0.95)]
      : null
    return { name, count: s.count, deny: s.deny, allow: s.allow, context: s.context, ask: s.ask, avg_ms, p95_ms }
  }).sort((a, b) => b.count - a.count)

  return { total_entries: lines.length, scanned: processed, filter: { rule: filterRule || null, event: filterEvent || null }, rules: results }
}

function _isPaused() {
  const src = _readEnv()
  const m = src.match(/^HOOKS_PAUSED=(.+)$/m)
  return m ? m[1].trim() === '1' : false
}

function _readEnv() {
  const envFile = resolve(PROJECT_ROOT, '.env')
  return existsSync(envFile) ? readFileSync(envFile, 'utf-8') : ''
}

function _writeEnv(content) {
  writeFileSync(resolve(PROJECT_ROOT, '.env'), content, 'utf-8')
}

function pause(_input) {
  let src = _readEnv()
  if (/^HOOKS_PAUSED=/m.test(src)) {
    src = src.replace(/^HOOKS_PAUSED=.*/m, 'HOOKS_PAUSED=1')
  } else {
    src = src.trimEnd() + '\nHOOKS_PAUSED=1\n'
  }
  _writeEnv(src)
  return { paused: true, message: 'Hooks are paused — all events pass through. Run resume to re-enable rule processing.' }
}

function resume(_input) {
  let src = _readEnv()
  if (/^HOOKS_PAUSED=/m.test(src)) {
    src = src.replace(/^HOOKS_PAUSED=.*/m, 'HOOKS_PAUSED=0')
    _writeEnv(src)
  }
  return { paused: false, message: 'Hook rules resumed.' }
}

async function restart(_input, ctx) {
  // Detect daemon mode: env var OR pidfile matches our pid
  const pidFile = join(PROJECT_ROOT, 'run', 'hook.pid')
  const isDaemon = process.env.__HOOKS_DAEMON_CHILD === '1'
    || (existsSync(pidFile) && readFileSync(pidFile, 'utf-8').trim() === String(process.pid))

  if (isDaemon) {
    // Rebuild daemon args from runtime state (source of truth, not argv)
    const daemonArgs = ['--daemon']
    if (process.argv.includes('--sse')) daemonArgs.push('--sse')

    const { fork } = await import('node:child_process')
    const helperPath = resolve(__dirname, '..', '..', 'adapters', 'restart-helper.mjs')
    const helper = fork(helperPath, [
      '--old-pid', String(process.pid),
      '--project-root', PROJECT_ROOT,
      '--', ...daemonArgs
    ], { detached: true, stdio: 'ignore' })
    helper.unref()
    return { restarting: true, oldPid: process.pid, helper: helper.pid }
  }

  // Non-daemon mode: exit, let wrapper respawn
  if (ctx.transport) {
    process.stdout.write(JSON.stringify(ctx.transport.notifyToolsChanged()) + '\n')
  }
  setTimeout(() => process.exit(0), 100)
  return { restarting: true, message: 'MCP server exiting — reconnect to reload config' }
}

async function health({ cwd }, _ctx) {
  const targetCwd = cwd || process.cwd()
  const { assess } = await import('../../extend/hooks/features/health/health.mjs')
  return assess(targetCwd)
}

export const handlers = { config, check, status, reload, restart, pause, resume, schema, logs, analytics, health }
