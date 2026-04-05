// UserPromptSubmit.mjs — Handle UserPromptSubmit hook events
// Only systemMessage allowed; always continue=true
// ObjectTree-first: build → operate → return

import { ObjectTree } from '../../../lib/schema2object.mjs'
import { _resolveMessage } from './_shared.mjs'

function _noop() {}

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
  response.hookSpecificOutput = hso

  return response
}
