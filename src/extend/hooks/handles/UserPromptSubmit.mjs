// UserPromptSubmit.mjs — Handle UserPromptSubmit hook events
// Only systemMessage allowed; always continue=true
// ObjectTree-first: build → operate → return

import { ObjectTree } from '../../../lib/schema2object.mjs'
import { _resolveMessage } from './_shared.mjs'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = resolve(__dirname, '..', '..', '..', '..', 'logs', 'agent-state.json')

function _noop() {}

// Read agent buff for session, clear it, write back
function _drainAgentBuff(sessionId, log) {
  if (!existsSync(STATE_FILE)) return null
  let state
  try { state = JSON.parse(readFileSync(STATE_FILE, 'utf-8')) }
  catch { return null }

  const items = state.buff?.[sessionId]
  if (!items || !items.length) return null

  const result = items.join('\n\n---\n\n')
  state.buff[sessionId] = []

  // Atomic write back
  try {
    const tmp = STATE_FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(state, null, 2))
    renameSync(tmp, STATE_FILE)
  } catch (e) {
    log('warn', `agent-buff:write-back failed: ${e.message}`)
  }

  log('info', `agent-buff:drain session=${sessionId} items=${items.length} len=${result.length}`)
  return result
}

export function handle(payload) {
  const { rule, event, schema, featureResult, log: _log } = payload
  const log = _log || _noop

  // Build response ObjectTree from schema
  const response = new ObjectTree({}, schema.responseSchema, schema.loader)

  response.continue = true

  const msg = _resolveMessage(rule, event, featureResult, log)
  if (msg) {
    response.systemMessage = msg
  }

  // Build HSO then one-shot set
  const hso = { hookEventName: 'UserPromptSubmit' }

  // Drain agent buff → additionalContext
  const agentBuff = _drainAgentBuff(event.session_id, log)
  if (agentBuff) {
    hso.additionalContext = agentBuff
  }

  response.hookSpecificOutput = hso

  return response
}
