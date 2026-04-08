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
const maxTurns       = parseInt(argVal('--max-turns') || '20', 10)
const maxBudgetUsd   = parseFloat(argVal('--max-budget') || '0.25')
const promptFile     = argVal('--prompt-file')
const allowedTools   = (argVal('--allowed-tools') || 'Read,Grep,Glob').split(',')
const disallowedTools = (argVal('--disallowed-tools') || 'Bash,Edit,Write,NotebookEdit').split(',')
const permissionMode = argVal('--permission-mode') || 'bypassPermissions'
const dangerousSkip  = args.includes('--dangerous-skip')
const totalLines     = parseInt(argVal('--total-lines') || '0', 10)
const resumeId       = argVal('--resume')
const customPrompt   = argVal('--prompt')

if (!sessionId) {
  process.send?.({ type: 'error', message: 'missing --session-id' })
  process.exit(1)
}

// --- Build prompt ---
// Init: agent.md instructions + task context as user prompt (SDK has own system prompt)
// Wake: resume session, only send update notification
let agentInstructions = ''
if (promptFile && existsSync(promptFile)) {
  agentInstructions = readFileSync(promptFile, 'utf-8')
}

// Build base prompt by state
let basePrompt
if (resumeId) {
  basePrompt = `Transcript updated. Path: ${transcriptPath}\nTotal lines: ${totalLines}. Your last read position: line ${lastLine}. Analyze new content since then.`
} else if (!transcriptPath || !existsSync(transcriptPath)) {
  basePrompt = `New session started. Session ID: ${sessionId}. No transcript available yet.`
} else {
  basePrompt = `New session started. Transcript: ${transcriptPath}\nTotal lines: ${totalLines}. Observe and analyze.`
}

// Compose: instructions + base + custom task (if any)
const parts = []
if (!resumeId && agentInstructions) parts.push(agentInstructions)
parts.push(basePrompt)
if (customPrompt) parts.push(`\nTask: ${customPrompt}`)
const userPrompt = parts.join('\n\n---\n\n')

// --- IPC send helper (fallback to stderr if not forked) ---
function ipcSend(msg) {
  if (process.send) { process.send(msg); return }
  process.stderr.write(JSON.stringify(msg) + '\n')
}

// --- Run SDK query ---
async function run() {
  const opts = {
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

      // Result event — final output after all tool calls complete
      if (msg.type === 'result') {
        if (msg.session_id) sdkSessionId = msg.session_id

        // SDKResultSuccess has .result (string), SDKResultError has .errors (string[])
        const text = msg.is_error
          ? (msg.errors || []).join('; ')
          : (msg.result || '')
        const trimmed = text.trim()

        if (trimmed && trimmed !== 'OK') {
          ipcSend({ type: 'buff', text: trimmed })
        }
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
