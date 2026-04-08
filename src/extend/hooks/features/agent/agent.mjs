// agent/agent.mjs — Observer agent feature (object module pattern)
// Self-contained process manager. Fork subprocess per session, IPC buff back.
// Daemon unaware of workers — agent manages own _children Map.
//
// Factory: createAgent(config, bus, loader) → ObjectTree
// x-methods: execute, collect, cleanup, init, status

import { fork } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { appendTextLog } from '../../../../foundation/log-file.mjs'
import { ObjectTree } from '../../../../lib/schema2object.mjs'

const AGENT_DIR = import.meta.dirname
const WORKER_PATH = join(AGENT_DIR, 'agent-worker.mjs')
const LOGS_DIR = resolve(AGENT_DIR, '..', '..', '..', '..', '..', 'logs')
const STATE_FILE = join(LOGS_DIR, 'agent-state.json')

export function createAgent(config, bus, loader) {
  // --- In-memory state ---
  const _sessions = new Map()   // hookSessionId → SessionEntry
  const _buff = new Map()       // hookSessionId → string[]
  const _children = new Map()   // hookSessionId → ChildProcess
  const _active = new Set()     // hookSessionId — concurrent dispatch guard
  let _isDaemon = false

  // --- Schema config (from agent.schema.json via ObjectTree $withDefaults) ---
  const _cfg = config || {}
  const _sdk = _cfg.sdk || {}
  const _worker = _cfg.worker || {}

  // --- Logging ---
  function _log(level, sessionId, msg) {
    const event = `agent:${sessionId || 'global'}`
    if (bus) {
      bus.send('log', { ts: Date.now(), level, event, message: msg })
        .catch(() => appendTextLog(LOGS_DIR, level, event, msg))
      return
    }
    appendTextLog(LOGS_DIR, level, event, msg)
  }

  // --- State persistence (atomic write) ---
  // Recursion guard: is this sessionId an agent-spawned SDK session?
  // Reads state file (same source as UserPromptSubmit handler pattern)
  function _isAgentSession(sessionId) {
    const state = _readState()
    for (const entry of Object.values(state.sessions || {})) {
      if (entry.sdkSessionId === sessionId) return true
    }
    return false
  }

  function _readState() {
    if (!existsSync(STATE_FILE)) return { sessions: {}, buff: {} }
    try { return JSON.parse(readFileSync(STATE_FILE, 'utf-8')) }
    catch { return { sessions: {}, buff: {} } }
  }

  function _writeState() {
    try {
      mkdirSync(LOGS_DIR, { recursive: true })
      const data = { sessions: {}, buff: {} }
      for (const [sid, entry] of _sessions) {
        data.sessions[sid] = {
          sdkSessionId: entry.sdkSessionId,
          pid: entry.pid,
          lastLine: entry.lastLine,
          transcriptPath: entry.transcriptPath,
          spawnedAt: entry.spawnedAt,
        }
      }
      for (const [sid, items] of _buff) {
        if (items.length) data.buff[sid] = items
      }
      const tmp = STATE_FILE + '.tmp'
      writeFileSync(tmp, JSON.stringify(data, null, 2))
      renameSync(tmp, STATE_FILE)
    } catch (e) {
      _log('error', null, `state:write failed: ${e.message}`)
    }
  }

  // --- Transcript line count (fast buffer scan) ---
  function _countLines(filePath) {
    try {
      if (!filePath || !existsSync(filePath)) return 0
      const buf = readFileSync(filePath)
      let count = 0
      for (let i = 0; i < buf.length; i++) { if (buf[i] === 10) count++ }
      return count
    } catch { return 0 }
  }

  // --- Worker subprocess management ---
  function _forkWorker(sessionId, transcriptPath, opts) {
    const promptFile = resolve(AGENT_DIR, _worker.systemPromptFile || 'agent.md')
    const totalLines = _countLines(transcriptPath)
    const args = [
      '--session-id', sessionId,
      '--transcript', transcriptPath || '',
      '--last-line', String(opts.lastLine || 0),
      '--total-lines', String(totalLines),
      '--model', _sdk.model || 'haiku',
      '--max-turns', String(_sdk.maxTurns || 3),
      '--max-budget', String(_sdk.maxTurnBudgetUsd || 0.25),
      '--prompt-file', promptFile,
      '--allowed-tools', (_sdk.allowedTools || ['Read', 'Grep', 'Glob']).join(','),
      '--disallowed-tools', (_sdk.disallowedTools || ['Bash', 'Edit', 'Write', 'NotebookEdit']).join(','),
      '--permission-mode', _sdk.permissionMode || 'bypassPermissions',
    ]
    if (_sdk.allowDangerouslySkipPermissions !== false) args.push('--dangerous-skip')
    if (opts.sdkSessionId) args.push('--resume', opts.sdkSessionId)

    _log('debug', sessionId, `fork:start args=${args.join(' ')}`)

    const child = fork(WORKER_PATH, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      execArgv: [], // Clean slate — no inherited --input-type or debug flags
    })
    child.unref()

    // IPC message handler
    child.on('message', (msg) => _onMessage(sessionId, msg))

    // Exit handler
    child.on('exit', (code) => _onExit(sessionId, code))

    // Stderr capture → log
    if (child.stderr) {
      const chunks = []
      child.stderr.on('data', (d) => chunks.push(d))
      child.stderr.on('end', () => {
        const err = Buffer.concat(chunks).toString('utf-8').trim()
        if (err) _log('warn', sessionId, `worker:stderr ${err.slice(0, 500)}`)
      })
    }

    _children.set(sessionId, child)
    _log('debug', sessionId, `fork:done pid=${child.pid}`)
    return child
  }

  function _killWorker(sessionId) {
    const child = _children.get(sessionId)
    if (!child) return
    _log('debug', sessionId, `kill:start pid=${child.pid}`)
    try { child.kill('SIGTERM') } catch {}
    // Timeout 3s → SIGKILL
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
    }, 3000)
    child.on('exit', () => clearTimeout(timer))
  }

  function _onMessage(sessionId, msg) {
    if (!msg || !msg.type) return

    const prefix = _worker.buffPrefix || '<!-- agent-observer -->\n'

    if (msg.type === 'buff') {
      // trace: IPC buff received
      if (!_buff.has(sessionId)) _buff.set(sessionId, [])
      _buff.get(sessionId).push(prefix + msg.text)
      _log('debug', sessionId, `ipc:buff len=${msg.text.length}`)
    }

    if (msg.type === 'done') {
      // trace: worker completed
      const entry = _sessions.get(sessionId)
      if (entry) {
        entry.sdkSessionId = msg.sdkSessionId || null
        entry.pid = null  // worker exited
      }
      _active.delete(sessionId)
      _writeState()
      _log('info', sessionId, `ipc:done sdkSession=${msg.sdkSessionId || '(none)'}`)
    }

    if (msg.type === 'error') {
      _log('error', sessionId, `ipc:error ${msg.message}`)
      _active.delete(sessionId)
      _sessions.delete(sessionId)
      _writeState()
    }
  }

  function _onExit(sessionId, code) {
    _children.delete(sessionId)
    const entry = _sessions.get(sessionId)
    if (entry) entry.pid = null
    if (code !== 0 && code !== null) {
      _log('warn', sessionId, `worker:exit code=${code}`)
    }
    _active.delete(sessionId)
  }

  // --- Dispatch: spawn or restart worker ---
  function _dispatch(sessionId, transcriptPath, agentConfig) {
    // daemonOnly guard
    const daemonOnly = _cfg.daemonOnly !== false
    if (daemonOnly && !_isDaemon) {
      _log('debug', sessionId, 'dispatch:skip branch=not-daemon+daemonOnly')
      return
    }

    // Concurrent dispatch guard
    if (_active.has(sessionId)) {
      _log('debug', sessionId, 'dispatch:skip branch=active')
      return
    }
    _active.add(sessionId)

    const session = _sessions.get(sessionId)

    if (_children.has(sessionId)) {
      // Restart: fork new → kill old
      _log('debug', sessionId, 'dispatch:restart')
      const newChild = _forkWorker(sessionId, transcriptPath, {
        lastLine: session?.lastLine || 0,
        sdkSessionId: session?.sdkSessionId || null,
      })
      _killWorker(sessionId) // kills old, _children already updated by _forkWorker
      _children.set(sessionId, newChild)
      if (session) session.pid = newChild.pid
    } else {
      // Spawn new
      _log('debug', sessionId, 'dispatch:spawn')
      const child = _forkWorker(sessionId, transcriptPath, {
        lastLine: session?.lastLine || 0,
        sdkSessionId: session?.sdkSessionId || null,
      })
      if (!session) {
        _sessions.set(sessionId, {
          sdkSessionId: null,
          pid: child.pid,
          lastLine: 0,
          transcriptPath: transcriptPath || '',
          spawnedAt: new Date().toISOString(),
        })
      } else {
        session.pid = child.pid
      }
    }

    if (!_buff.has(sessionId)) _buff.set(sessionId, [])
    _writeState()
  }

  // --- Build ObjectTree ---
  let agentSchema
  try { agentSchema = loader?.resolve('features/agent/agent.schema.json')?.node } catch {}

  const tree = new ObjectTree(_cfg, agentSchema || { type: 'object' }, loader)

  // x-methods: execute — feature interface, sync return null
  tree.execute = function(event, agentConfig) {
    const sessionId = event.session_id
    if (!sessionId) {
      _log('debug', '__none__', 'execute:skip branch=no-session-id')
      return null
    }

    // Recursion guard: check state file for agent-spawned sessions
    if (_isAgentSession(sessionId)) {
      _log('debug', sessionId, 'execute:skip branch=agent-session (recursion guard)')
      return null
    }

    const transcriptPath = event.transcript_path || ''
    _log('debug', sessionId, `execute:entry event=${event.hook_event_name} transcript=${transcriptPath || '(none)'}`)

    // Fire-and-forget async dispatch
    try {
      _dispatch(sessionId, transcriptPath, agentConfig)
    } catch (e) {
      _log('error', sessionId, `execute:dispatch failed: ${e.message}`)
    }

    return null // Feature contract: sync return
  }

  // x-methods: collect — drain buff for session
  tree.collect = function(sessionId) {
    const items = _buff.get(sessionId)
    if (!items || !items.length) return null
    const result = items.join('\n\n---\n\n')
    _buff.set(sessionId, [])
    _writeState()
    _log('info', sessionId, `collect:done drained=${items.length} len=${result.length}`)
    return result
  }

  // x-methods: cleanup — kill workers, clear state
  tree.cleanup = function(sessionId) {
    if (sessionId) {
      _log('debug', sessionId, 'cleanup:session')
      _killWorker(sessionId)
      _children.delete(sessionId)
      _sessions.delete(sessionId)
      _buff.delete(sessionId)
      _active.delete(sessionId)
    } else {
      _log('debug', null, `cleanup:all sessions=${_sessions.size}`)
      for (const sid of [..._children.keys()]) {
        _killWorker(sid)
      }
      _children.clear()
      _sessions.clear()
      _buff.clear()
      _active.clear()
    }
    _writeState()
  }

  // x-methods: init — set daemon flag, restore state
  tree.init = function(isDaemon) {
    _isDaemon = isDaemon
    if (isDaemon) {
      const state = _readState()
      for (const [sid, entry] of Object.entries(state.sessions || {})) {
        _sessions.set(sid, { ...entry })
      }
      for (const [sid, items] of Object.entries(state.buff || {})) {
        _buff.set(sid, items)
      }
      _log('info', null, `init:done daemon=true restored sessions=${_sessions.size} buffs=${_buff.size}`)
    } else {
      _log('info', null, 'init:done daemon=false')
    }
  }

  // x-methods: status — all session summaries
  tree.status = function() {
    const out = {}
    for (const [sid, entry] of _sessions) {
      let alive = false
      if (entry.pid) {
        try { process.kill(entry.pid, 0); alive = true } catch {}
      }
      out[sid] = {
        sdkSessionId: entry.sdkSessionId,
        pid: entry.pid,
        alive,
        lastLine: entry.lastLine,
        transcriptPath: entry.transcriptPath,
        spawnedAt: entry.spawnedAt,
        buffCount: (_buff.get(sid) || []).length,
        active: _active.has(sid),
      }
    }
    return out
  }

  _log('debug', null, `createAgent:done bus=${bus ? 'connected' : 'null'}`)
  return tree
}
