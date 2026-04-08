#!/usr/bin/env node
// agent-worker.mjs — Isolated subprocess for SDK query()
// Spawned by agent.mjs via fork(). Communicates via IPC.
//
// Args: --session-id <id> --transcript <path> --last-line <n>
//       --model <model> --max-turns <n> --max-budget <usd>
//       --prompt-file <path> --allowed-tools <csv> --disallowed-tools <csv>
//       --permission-mode <mode> --dangerous-skip
//       --resume <sdkSessionId>
//
// IPC out: { type: 'buff', text } | { type: 'done', sdkSessionId } | { type: 'error', message }

import { query } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync, existsSync } from 'node:fs'

// --- Parse args ---
const args = process.argv.slice(2)
function argVal(flag) {
  const i = args.indexOf(flag)
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null
}

const sessionId      = argVal('--session-id')
const transcriptPath = argVal('--transcript')
const lastLine       = parseInt(argVal('--last-line') || '0', 10)
const model          = argVal('--model') || 'haiku'
const maxTurns       = parseInt(argVal('--max-turns') || '1', 10)
const maxBudgetUsd   = parseFloat(argVal('--max-budget') || '0.01')
const promptFile     = argVal('--prompt-file')
const allowedTools   = (argVal('--allowed-tools') || 'Read,Grep,Glob').split(',')
const disallowedTools = (argVal('--disallowed-tools') || 'Bash,Edit,Write,NotebookEdit').split(',')
const permissionMode = argVal('--permission-mode') || 'bypassPermissions'
const dangerousSkip  = args.includes('--dangerous-skip')
const totalLines     = parseInt(argVal('--total-lines') || '0', 10)
const resumeId       = argVal('--resume')

if (!sessionId) {
  process.send?.({ type: 'error', message: 'missing --session-id' })
  process.exit(1)
}

// --- Build prompt ---
let systemPrompt = 'You are an observer agent. Analyze the session transcript and provide feedback.'
if (promptFile && existsSync(promptFile)) {
  systemPrompt = readFileSync(promptFile, 'utf-8')
}

// Determine wake vs init prompt — give goal, not tool instructions.
// Agent has Read/Grep/Glob and agent.md defines the workflow.
let userPrompt
if (resumeId) {
  userPrompt = `Transcript updated. Path: ${transcriptPath}\nTotal lines: ${totalLines}. Your last read position: line ${lastLine}. Analyze new content since then.`
} else if (!transcriptPath || !existsSync(transcriptPath)) {
  userPrompt = `New session started. Session ID: ${sessionId}. No transcript available yet.`
} else {
  userPrompt = `New session started. Transcript: ${transcriptPath}\nTotal lines: ${totalLines}. Observe and analyze.`
}

// --- IPC send helper (fallback to stderr if not forked) ---
function ipcSend(msg) {
  if (process.send) { process.send(msg); return }
  process.stderr.write(JSON.stringify(msg) + '\n')
}

// --- Run SDK query ---
async function run() {
  const opts = {
    systemPrompt,
    model,
    maxTurns,
    maxBudgetUsd,
    allowedTools,
    disallowedTools,
    permissionMode,
  }
  if (dangerousSkip) opts.allowDangerouslySkipPermissions = true
  if (resumeId) opts.resume = resumeId

  const iter = query({ prompt: userPrompt, options: opts })
  let sdkSessionId = null

  try {
    for await (const msg of iter) {
      // Capture SDK session ID
      if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
        sdkSessionId = msg.session_id
      }

      // Capture assistant text → buff
      if (msg.type === 'assistant' && msg.message?.content) {
        const text = msg.message.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('')
          .trim()

        if (text && text !== 'OK') {
          ipcSend({ type: 'buff', text })
        }
      }

      // Result event — capture session ID from result too
      if (msg.type === 'result' && msg.session_id) {
        sdkSessionId = msg.session_id
      }
    }
  } catch (e) {
    // Budget exceeded or max turns reached = normal completion
    if (e.message?.includes('budget') || e.message?.includes('turns')) {
      ipcSend({ type: 'done', sdkSessionId: sdkSessionId || '' })
      return
    }
    throw e
  }

  ipcSend({ type: 'done', sdkSessionId: sdkSessionId || '' })
}

run().catch(e => {
  ipcSend({ type: 'error', message: e.message })
  process.exit(1)
})
