#!/usr/bin/env node
// e2e-agent-worker.mjs — Fork agent-worker, wait for completion, report sdkSessionId
// Usage: node tests/e2e-agent-worker.mjs

import { fork } from 'node:child_process'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'

const WORKER = resolve(import.meta.dirname, '..', 'src', 'extend', 'hooks', 'features', 'agent', 'agent-worker.mjs')
const PROMPT = resolve(import.meta.dirname, '..', 'src', 'extend', 'hooks', 'features', 'agent', 'agent.md')
const TRANSCRIPT = '/home/claude/.claude/projects/-home-claude-projects/df5c5953-f00c-4630-9d24-106e6d36f6a2.jsonl'
const LOG_FILE = resolve(import.meta.dirname, '..', 'logs', 'e2e-worker-test.log')

const totalLines = 874
const readOffset = Math.max(0, totalLines - 200)

const args = [
  '--session-id', 'e2e-test-' + Date.now(),
  '--transcript', TRANSCRIPT,
  '--last-line', '0',
  '--total-lines', String(totalLines),
  '--model', 'haiku',
  '--max-turns', '3',
  '--max-budget', '0.25',
  '--prompt-file', PROMPT,
  '--allowed-tools', 'Read,Grep,Glob',
  '--disallowed-tools', 'Bash,Edit,Write,NotebookEdit',
  '--permission-mode', 'bypassPermissions',
  '--dangerous-skip',
]

const log = []
function ts() { return new Date().toISOString() }
function record(msg) { log.push(`${ts()} ${msg}`); console.log(msg) }

record(`fork:start worker=${WORKER}`)
record(`args: ${args.join(' ')}`)

const child = fork(WORKER, args, {
  detached: false,
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  execArgv: [],
})

record(`fork:done pid=${child.pid}`)

// Collect IPC
const ipcMessages = []
child.on('message', (msg) => {
  ipcMessages.push(msg)
  if (msg.type === 'buff') {
    record(`ipc:buff len=${msg.text.length} preview=${msg.text.slice(0, 120)}...`)
  } else {
    record(`ipc:${msg.type} ${JSON.stringify(msg)}`)
  }
})

// Stderr
const stderrChunks = []
if (child.stderr) {
  child.stderr.on('data', (d) => stderrChunks.push(d))
}

// Exit
child.on('exit', (code, signal) => {
  record(`exit: code=${code} signal=${signal}`)

  const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim()
  if (stderr) record(`stderr: ${stderr.slice(0, 500)}`)

  record(`ipc total: ${ipcMessages.length} messages`)

  // Find sdkSessionId
  const doneMsg = ipcMessages.find(m => m.type === 'done')
  if (doneMsg?.sdkSessionId) {
    record(`sdkSessionId: ${doneMsg.sdkSessionId}`)
    record(`session jsonl: ~/.claude/projects/-home-claude-projects-mcp-claude-hooks-master/${doneMsg.sdkSessionId}.jsonl`)
  }

  // Write log
  writeFileSync(LOG_FILE, log.join('\n') + '\n')
  record(`log written to ${LOG_FILE}`)
})

// Timeout 120s
setTimeout(() => {
  record('timeout: 120s reached, killing worker')
  child.kill('SIGTERM')
}, 120000)
