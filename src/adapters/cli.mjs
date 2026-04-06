// CLI adapter — IO conversion only. No boot logic.
//
// handleControl(command, argv, projectRoot) — daemon control (no boot)
// forkDaemon(argv, projectRoot) — fork daemon child, parent exits
// runCLI(core, argv) — interactive tool invocation

import { fork } from 'node:child_process'
import { resolve } from 'node:path'

function mainPath() {
  return resolve(import.meta.dirname, '..', 'main.mjs')
}

// --- Daemon control (no boot) ---

export async function handleControl(command, argv, projectRoot) {
  if (command === 'stop') {
    const { daemonStop } = await import('./daemon.mjs')
    const result = daemonStop(projectRoot)
    process.stdout.write(JSON.stringify(result) + '\n')
    process.exit(result.stopped ? 0 : 1)
  }

  if (command === 'status') {
    const { daemonStatus } = await import('./daemon.mjs')
    const result = daemonStatus(projectRoot)
    process.stdout.write(JSON.stringify(result) + '\n')
    process.exit(result.running ? 0 : 1)
  }

  if (command === 'reload') {
    const { reloadDaemon } = await import('./daemon.mjs')
    const result = reloadDaemon(projectRoot)
    process.stdout.write(JSON.stringify(result) + '\n')
    process.exit(result.reloaded ? 0 : 1)
  }

  if (command === 'restart') {
    const { connectDaemon, daemonStatus } = await import('./daemon.mjs')
    const st = daemonStatus(projectRoot)
    if (!st.running) {
      process.stdout.write(JSON.stringify({ restarted: false, reason: 'not running' }) + '\n')
      process.exit(1)
    }
    // Send restart via daemon socket → handler spawns restart-helper
    const client = connectDaemon(projectRoot)
    if (!client) {
      process.stdout.write(JSON.stringify({ restarted: false, reason: 'cannot connect to daemon' }) + '\n')
      process.exit(1)
    }
    const resp = await client.processEvent({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'hooks_admin', arguments: { action: 'restart', format: 'json' } }
    })
    const text = resp?.result?.content?.[0]?.text
    process.stdout.write((text || JSON.stringify(resp)) + '\n')
    process.exit(0)
  }
}

// --- Daemon fork (parent spawns child, exits) ---

export async function forkDaemon(argv, projectRoot) {
  const { daemonStatus } = await import('./daemon.mjs')
  const fs = await import('node:fs')
  const path = await import('node:path')
  const st = daemonStatus(projectRoot)
  if (st.running) {
    process.stdout.write(JSON.stringify({ started: false, reason: 'already running', pid: st.pid, socket: st.socket }) + '\n')
  } else {
    const logPath = path.join(projectRoot, 'run', 'daemon.err')
    const logStream = fs.createWriteStream(logPath, { flags: 'a' })
    const child = fork(mainPath(), argv, {
      detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, __HOOKS_DAEMON_CHILD: '1' }
    })
    if (child.stdout) child.stdout.pipe(logStream)
    if (child.stderr) child.stderr.pipe(logStream)
    child.unref()
    process.stdout.write(JSON.stringify({ started: true, pid: child.pid }) + '\n')
  }
  process.exit(0)
}

// --- CLI interactive (IO only, core from main.mjs) ---

export function runCLI(core, argv) {
  const flags = new Set()
  const positional = []
  for (const a of (argv || [])) {
    if (a === '--help' || a === '-h') flags.add('help')
    else if (a === '--json') flags.add('json')
    else if (!a.startsWith('--')) positional.push(a)
  }
  return dispatch(core, { category: positional[0], action: positional[1], positional, flags })
}

// --- Internal dispatch ---

async function dispatch(core, { category, action, positional, flags }) {
  if (!category) {
    const res = await send(core, 'tools/list')
    for (const t of res.result.tools) {
      const match = t.description.match(/^(.+?)(?:\s*Actions:)/)
      const desc = match ? match[1].trim() : t.description
      process.stdout.write(`  ${t.name.padEnd(20)} ${desc}\n`)
    }
    return exit(core, 0)
  }

  if ((flags.has('help') && !action) || !action) {
    const res = await call(core, category, {})
    if (res.result?.isError) return fail(core, res)
    const actions = parseContent(res)
    for (const a of actions) {
      process.stdout.write(`  ${a.name.padEnd(30)} ${a.summary}\n`)
    }
    return exit(core, 0)
  }

  const params = {}
  for (const arg of positional.slice(2)) {
    const eq = arg.indexOf('=')
    if (eq !== -1) {
      const key = arg.slice(0, eq)
      let val = arg.slice(eq + 1)
      try { val = JSON.parse(val) } catch {}
      params[key] = val
    }
  }
  if (flags.has('json')) params.format = 'json'

  const res = await call(core, category, { action, ...params })
  if (res.error) {
    process.stderr.write(`Error: ${res.error.message}\n`)
    return exit(core, 1)
  }
  if (res.result?.isError) return fail(core, res)

  const text = res.result?.content?.[0]?.text
  if (!text) return exit(core, 0)

  try {
    const parsed = JSON.parse(text)
    process.stdout.write(JSON.stringify(parsed, null, 2) + '\n')
  } catch {
    process.stdout.write(text + '\n')
  }
  return exit(core, 0)
}

async function send(core, method, params) {
  return core.handle({ jsonrpc: '2.0', method, id: 1, params })
}

async function call(core, category, args) {
  return send(core, 'tools/call', { name: category, arguments: args })
}

function parseContent(res) {
  const text = res.result?.content?.[0]?.text
  try { return JSON.parse(text) } catch { return [] }
}

function fail(core, res) {
  process.stderr.write((res.result?.content?.[0]?.text || 'Unknown error') + '\n')
  return exit(core, 1)
}

function exit(core, code) {
  const lc = core.lifecycle
  if (typeof lc?.stop === 'function') lc.stop()
  else if (typeof lc?.shutdown === 'function') lc.shutdown()
  process.exit(code)
}
