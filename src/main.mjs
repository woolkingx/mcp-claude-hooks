#!/usr/bin/env node
// main.mjs — data → boot(argv) → adapters(core) → core.handle
//
// Step 1: open log (first thing, before anything else)
// Step 2: boot core (daemon-first, fallback cold start)
// Step 3: start adapters by argv (multiple on same core)

import { resolve } from 'node:path'
import { appendTextLog } from './foundation/log-file.mjs'

const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const LOG_DIR = resolve(PROJECT_ROOT, 'logs')

// --- Step 1: open log immediately ---

function log(level, msg) {
  appendTextLog(LOG_DIR, level, 'main', msg)
}

log('debug', `START argv=${process.argv.slice(2).join(' ')} tty=${process.stdin.isTTY} ppid=${process.ppid} pid=${process.pid}`)

const argv = process.argv.slice(2)
const command = argv[0] || null

// --- Daemon control (no boot, no adapter) ---

if (['stop', 'status', 'reload', 'restart'].includes(command)) {
  const { handleControl } = await import('./adapters/cli.mjs')
  await handleControl(command, argv, PROJECT_ROOT)
}

// --- Daemon fork (parent exits) ---

const isDaemon = argv.includes('--daemon') || process.env.MCP_HOOKS_MODE === 'daemon'
if (isDaemon && !process.env.__HOOKS_DAEMON_CHILD && process.stdin.isTTY === true) {
  const { forkDaemon } = await import('./adapters/cli.mjs')
  await forkDaemon(argv, PROJECT_ROOT)
}
// Keep __HOOKS_DAEMON_CHILD so admin:restart knows it's daemon mode
// (was: delete process.env.__HOOKS_DAEMON_CHILD)

// --- Step 2: boot core (daemon-first → cold start) ---

const { connectDaemon } = await import('./adapters/daemon.mjs')
const daemon = (!isDaemon) ? connectDaemon(PROJECT_ROOT) : null
let core

if (daemon) {
  log('debug', `daemon proxy pid=${daemon.pid}`)
  // CoreShape: proxy mode — all fields present, nullable ones null
  core = {
    handle: (msg) => daemon.processEvent(msg),
    bus: {
      send(event, payload) {
        if (event === 'log') return daemon.processEvent({ _log: true, ...payload }).catch(() => {})
        return daemon.processEvent(payload)
      },
      has: () => false
    },
    errorCodes: { PARSE_ERROR: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL_ERROR: -32603 },
    lifecycle: { ready() {}, stop() {}, shutdown() {}, getState: () => 'ready' },
    runtime: null,
    transport: null
  }
} else {
  log('debug', isDaemon ? 'cold start (daemon)' : 'cold start')
  const { boot } = await import('./mcp.mjs')
  core = boot({ isDaemon }).core
}

// --- Step 3: start adapters by argv ---

const isHook = !process.stdin.isTTY && command !== 'cli' && command !== 'start' && !isDaemon

if (isHook) {
  const { runHook } = await import('./adapters/hook.mjs')
  await runHook(core)
  process.exit(0)
}

if (command === 'cli') {
  const { runCLI } = await import('./adapters/cli.mjs')
  runCLI(core, argv.slice(argv.indexOf('cli') + 1).filter(a => a !== '--debug'))
} else {
  // Long-running server requires full core (not proxy)
  if (!core.transport) {
    log('fatal', 'server mode requires cold-start core (transport is null)')
    process.exit(1)
  }
  const { startStdio } = await import('./adapters/stdio.mjs')
  startStdio(core, core.transport, core.errorCodes)

  if (isDaemon) {
    const { startDaemon } = await import('./adapters/daemon.mjs')
    startDaemon(core, { projectRoot: PROJECT_ROOT, processConfig: core.runtime.process })
  }

  if (argv.includes('--sse')) {
    const { startSSE } = await import('./adapters/sse.mjs')
    startSSE(core, core.transport, core.errorCodes)
  }

  core.lifecycle.ready()
}
