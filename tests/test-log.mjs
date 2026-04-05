#!/usr/bin/env node
// tests/test-log.mjs — Log pipeline: bus.send('log') → file sink → readable

import { describe, it, before, after, assert, ROOT } from './helpers/context.mjs'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { fork } from 'node:child_process'
import { LOG_FILENAME } from '../src/foundation/log-file.mjs'

const MAIN = join(ROOT, 'src', 'main.mjs')
const PID_FILE = join(ROOT, 'run', 'hook.pid')
const SOCKET = join(ROOT, 'run', 'hook.sock')
const LOG_DIR = join(ROOT, 'logs')
const LOG_FILE = join(LOG_DIR, LOG_FILENAME)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function grepLog(pattern) {
  if (!existsSync(LOG_FILE)) return []
  return readFileSync(LOG_FILE, 'utf-8').split('\n').filter(l => l.includes(pattern))
}

function sendToSocket(data) {
  return new Promise((resolve, reject) => {
    const conn = createConnection(SOCKET)
    let buf = ''
    const timeout = setTimeout(() => { conn.destroy(); reject(new Error('socket timeout')) }, 3000)
    conn.on('connect', () => conn.write(JSON.stringify(data) + '\n'))
    conn.on('data', chunk => {
      buf += chunk.toString()
      const nl = buf.indexOf('\n')
      if (nl !== -1) {
        clearTimeout(timeout)
        const line = buf.slice(0, nl).trim()
        conn.destroy()
        resolve(line ? JSON.parse(line) : null)
      }
    })
    conn.on('error', e => { clearTimeout(timeout); reject(e) })
  })
}

function killDaemon() {
  if (!existsSync(PID_FILE)) return
  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10)
  if (pid) try { process.kill(pid, 'SIGTERM') } catch {}
  try { unlinkSync(PID_FILE) } catch {}
  try { unlinkSync(SOCKET) } catch {}
}

describe('log — pipeline', () => {
  before(async () => {
    killDaemon()
    await sleep(500)
    const child = fork(MAIN, ['--daemon'], {
      detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, __HOOKS_DAEMON_CHILD: '1' }
    })
    child.unref()
    await sleep(1500)
  })

  after(() => { killDaemon() })

  it('pass-through event appears in log', async () => {
    const m = `log-test-passthrough-${Date.now()}`
    const r = await sendToSocket({
      hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command: `echo ${m}` }
    })
    assert.equal(r, null)
    await sleep(300)
    const hits = grepLog(m)
    assert.ok(hits.length > 0, `"${m}" not in log`)
  })

  it('deny event appears in log with action', async () => {
    const m = `log-test-deny-${Date.now()}`
    const r = await sendToSocket({
      hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command: `rm ${m}` }
    })
    assert.ok(r?.hookSpecificOutput?.permissionDecision === 'deny')
    await sleep(300)
    const hits = grepLog(m)
    assert.ok(hits.length > 0, `"${m}" not in log`)
    assert.ok(hits.find(l => l.includes('deny')), 'no deny in log line')
  })

  it('SessionStart appears in log', async () => {
    await sendToSocket({ hook_event_name: 'SessionStart', session_id: `log-test-session-${Date.now()}` })
    await sleep(300)
    const all = grepLog('SessionStart')
    const recent = all.filter(l => {
      const ts = new Date(l.slice(0, 24)).getTime()
      return Date.now() - ts < 5000
    })
    assert.ok(recent.length > 0, 'no recent SessionStart in log')
  })

  it('PostToolUse appears in log', async () => {
    const m = `log-test-post-${Date.now()}`
    await sendToSocket({
      hook_event_name: 'PostToolUse', tool_name: 'Bash',
      tool_input: { command: `echo ${m}` }, tool_output: 'ok'
    })
    await sleep(300)
    const hits = grepLog(m)
    assert.ok(hits.length > 0, `"${m}" not in log`)
  })

  it('UserPromptSubmit appears in log', async () => {
    const m = `log-test-prompt-${Date.now()}`
    await sendToSocket({
      hook_event_name: 'UserPromptSubmit', session_id: 'test', prompt: m
    })
    await sleep(300)
    const hits = grepLog('UserPromptSubmit')
    const recent = hits.filter(l => l.includes(m) || (Date.now() - new Date(l.slice(0, 24)).getTime() < 5000))
    assert.ok(recent.length > 0, 'no recent UserPromptSubmit in log')
  })

  it('debug filter entries appear in log', async () => {
    const m = `log-test-debug-${Date.now()}`
    await sendToSocket({
      hook_event_name: 'PreToolUse', tool_name: m, tool_input: {}
    })
    await sleep(300)
    const hits = grepLog(m)
    assert.ok(hits.length > 0, `"${m}" not in log`)
  })

  it('log forwarding via _log protocol', async () => {
    const m = `log-test-forward-${Date.now()}`
    await sendToSocket({ _log: true, level: 'info', message: m, event: 'test' })
    await sleep(300)
    const hits = grepLog(m)
    assert.ok(hits.length > 0, `"${m}" not in log`)
  })

  it('cold start produces log', () => {
    const hits = grepLog('START argv=')
    assert.ok(hits.length > 0, 'no START log from main.mjs')
  })
})
