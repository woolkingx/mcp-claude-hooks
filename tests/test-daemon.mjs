#!/usr/bin/env node
// tests/test-daemon.mjs — Daemon lifecycle: start → event → log → restart → verify

import { describe, it, before, after, assert, ROOT } from './helpers/context.mjs'
import { fork } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { LOG_FILENAME } from '../src/foundation/log-file.mjs'

const MAIN = join(ROOT, 'src', 'main.mjs')
const PID_FILE = join(ROOT, 'run', 'hook.pid')
const SOCKET = join(ROOT, 'run', 'hook.sock')
const LOG_DIR = join(ROOT, 'logs')

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function readPid() {
  if (!existsSync(PID_FILE)) return null
  return parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10)
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
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
  const pid = readPid()
  if (pid && isAlive(pid)) {
    try { process.kill(pid, 'SIGTERM') } catch {}
  }
  try { unlinkSync(PID_FILE) } catch {}
  try { unlinkSync(SOCKET) } catch {}
}

function grepLog(pattern) {
  const logFile = join(LOG_DIR, LOG_FILENAME)
  if (!existsSync(logFile)) return []
  return readFileSync(logFile, 'utf-8').split('\n').filter(l => l.includes(pattern))
}

let pid1 = null

describe('daemon', () => {
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

  describe('lifecycle', () => {
    it('pidfile exists', () => {
      assert.ok(existsSync(PID_FILE), 'pidfile missing')
    })

    it('socket exists', () => {
      assert.ok(existsSync(SOCKET), 'socket missing')
    })

    it('daemon alive', () => {
      pid1 = readPid()
      assert.ok(pid1 && isAlive(pid1), `pid ${pid1} not alive`)
    })
  })

  describe('event handling', () => {
    const marker = `test-daemon-${Date.now()}`

    it('raw event pass-through', async () => {
      const resp = await sendToSocket({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: `echo ${marker}` }
      })
      assert.equal(resp, null, `expected null, got ${JSON.stringify(resp)}`)
    })

    it('engine logged the event', async () => {
      await sleep(500)
      const hits = grepLog(marker)
      assert.ok(hits.length > 0, `marker "${marker}" not found in log`)
    })

    it('rm → deny via socket', async () => {
      const resp = await sendToSocket({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'rm foo.txt' }
      })
      assert.ok(resp, 'expected response, got null')
      assert.equal(resp.hookSpecificOutput?.permissionDecision, 'deny')
    })
  })

  describe('JSON-RPC', () => {
    it('hooks_admin status via JSON-RPC', async () => {
      const resp = await sendToSocket({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'hooks_admin', arguments: { action: 'status', format: 'json' } }
      })
      assert.ok(resp?.result, 'no result')
      const text = resp.result.content?.[0]?.text
      assert.ok(text, 'no content text')
      const data = JSON.parse(text)
      assert.equal(data.server, 'mcp-claude-hooks')
    })
  })

  describe('restart', () => {
    it('restart dispatches helper', async () => {
      pid1 = readPid()
      const resp = await sendToSocket({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'hooks_admin', arguments: { action: 'restart', format: 'json' } }
      })
      assert.ok(resp?.result, 'no result')
      const text = resp.result.content?.[0]?.text
      assert.ok(text, 'no content text')
      const data = JSON.parse(text)
      assert.ok(data.restarting, 'not restarting')
      assert.ok(data.oldPid, 'no oldPid')
      assert.ok(data.helper, 'no helper pid')
    })

    it('old daemon dead after restart', async () => {
      // Helper: fork new → wait ready → stop old. Poll until old dies or timeout.
      const deadline = Date.now() + 10000
      while (isAlive(pid1) && Date.now() < deadline) await sleep(500)
      assert.ok(!isAlive(pid1), `old pid ${pid1} still alive after 10s`)
    })

    it('new daemon responds on socket', async () => {
      const newPid = readPid()
      assert.ok(newPid, 'no pidfile after restart')
      assert.notEqual(newPid, pid1, 'pid unchanged after restart')
      const resp = await sendToSocket({
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'hooks_admin', arguments: { action: 'status', format: 'json' } }
      })
      assert.ok(resp?.result, 'no JSON-RPC result from new daemon')
      const text = resp.result.content?.[0]?.text
      const data = JSON.parse(text)
      assert.equal(data.server, 'mcp-claude-hooks')
    })

    it('new daemon handles events', async () => {
      const marker2 = `test-daemon-post-restart-${Date.now()}`
      const resp = await sendToSocket({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: `echo ${marker2}` }
      })
      assert.equal(resp, null)
      await sleep(500)
      const hits = grepLog(marker2)
      assert.ok(hits.length > 0, `marker "${marker2}" not found in log`)
    })
  })
})
