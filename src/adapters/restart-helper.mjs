#!/usr/bin/env node
// restart-helper.mjs — Detached subprocess that orchestrates daemon restart.
// Spawned by admin handler. Runs outside the old daemon process.
//
// Flow: fork new daemon → wait ready → stop old daemon → cleanup → exit
//
// Args: --old-pid <pid> --project-root <path>

import { fork } from 'node:child_process'
import { existsSync, createWriteStream, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createConnection } from 'node:net'

const args = process.argv.slice(2)
const oldPid = parseInt(argVal('--old-pid'), 10)
const projectRoot = argVal('--project-root')
const separatorIdx = args.indexOf('--')
const daemonArgs = separatorIdx !== -1 ? args.slice(separatorIdx + 1) : ['--daemon']

if (!oldPid || !projectRoot) {
  process.stderr.write('usage: restart-helper --old-pid <pid> --project-root <path> [-- daemon-args...]\n')
  process.exit(1)
}

const mainPath = resolve(projectRoot, 'src', 'main.mjs')
const socketPath = resolve(projectRoot, 'run', 'hook.sock')
const pidPath = resolve(projectRoot, 'run', 'hook.pid')
const daemonErrPath = resolve(projectRoot, 'run', 'daemon.err')
const helperLogPath = resolve(projectRoot, 'run', 'helper.log')

const _logStream = createWriteStream(helperLogPath, { flags: 'a' })
function _log(msg) {
  const line = `${new Date().toISOString()} [restart-helper] ${msg}\n`
  _logStream.write(line)
}

async function run() {
  _log(`start old=${oldPid} root=${projectRoot}`)
  // 1. Fork new daemon
  const logStream = createWriteStream(daemonErrPath, { flags: 'a' })
  const child = fork(mainPath, daemonArgs, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, __HOOKS_DAEMON_CHILD: '1', __HOOKS_MANAGED_RESTART: '1' }
  })
  if (child.stdout) child.stdout.pipe(logStream)
  if (child.stderr) child.stderr.pipe(logStream)
  child.unref()

  _log(`forked child pid=${child.pid}`)

  // 2. Wait new daemon owns pidfile (not old pid), max 5s
  const newPid = await waitNewPid(5000).catch(e => { _log(`waitNewPid failed: ${e.message}`); return null })
  if (!newPid) {
    _log('new daemon did not write pidfile within 5s')
    try { child.kill('SIGTERM') } catch {}
    process.exit(1)
  }
  _log(`new pid=${newPid}`)

  // 3. Wait new daemon socket connectable, max 5s
  const ready = await waitSocketReady(5000).catch(e => { _log(`waitSocket failed: ${e.message}`); return false })
  if (!ready) {
    _log('new daemon socket not ready within 5s')
    try { child.kill('SIGTERM') } catch {}
    process.exit(1)
  }
  _log('new daemon socket ready')

  // 4. Stop old daemon
  _log(`stopping old pid=${oldPid}`)
  try { process.kill(oldPid, 'SIGTERM') } catch {}

  // 5. Wait old daemon gone, max 3s
  await waitPidGone(oldPid, 3000)
  _log(`old daemon gone, new alive=${isAlive(newPid)}`)

  // 6. Verify new daemon still alive
  if (isAlive(newPid)) {
    process.stdout.write(JSON.stringify({ restarted: true, oldPid, newPid }) + '\n')
  } else {
    _log('new daemon died after old daemon stopped')
    process.exit(1)
  }
}

// --- helpers ---

function argVal(flag) {
  const i = args.indexOf(flag)
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

function readPid() {
  if (!existsSync(pidPath)) return null
  return parseInt(readFileSync(pidPath, 'utf-8').trim(), 10) || null
}

function waitNewPid(timeoutMs) {
  const start = Date.now()
  return new Promise((res, rej) => {
    function check() {
      if (Date.now() - start > timeoutMs) return rej(new Error('timeout'))
      const pid = readPid()
      if (pid && pid !== oldPid) return res(pid)
      setTimeout(check, 200)
    }
    check()
  })
}

function waitSocketReady(timeoutMs) {
  const start = Date.now()
  return new Promise((res, rej) => {
    function attempt() {
      if (Date.now() - start > timeoutMs) return rej(new Error('timeout'))
      const conn = createConnection(socketPath)
      conn.on('connect', () => { conn.destroy(); res(true) })
      conn.on('error', () => { setTimeout(attempt, 200) })
    }
    attempt()
  })
}

function waitPidGone(pid, timeoutMs) {
  return new Promise(res => {
    const start = Date.now()
    function check() {
      if (!isAlive(pid) || Date.now() - start > timeoutMs) return res()
      setTimeout(check, 100)
    }
    check()
  })
}

run().catch(e => {
  process.stderr.write(`restart-helper error: ${e.message}\n`)
  process.exit(1)
})
