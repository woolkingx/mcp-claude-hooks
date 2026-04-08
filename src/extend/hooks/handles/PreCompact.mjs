// PreCompact.mjs — Handle PreCompact hook events
// ObjectTree-first: build → operate → return

import { ObjectTree } from '../../../lib/schema2object.mjs'
import { _resolveMessage } from './_shared.mjs'

function _noop() {}

export function handle(payload) {
  const { rule, event, schema, featureResult, log: _log } = payload
  const log = _log || _noop

  // Build response ObjectTree from schema
  const response = new ObjectTree({}, schema.responseSchema, schema.loader)

  response.continue = rule.action !== 'deny'

  const hso = { hookEventName: 'PreCompact' }
  const msg = _resolveMessage(rule, event, featureResult, log)
  if (msg) {
    hso.additionalContext = msg
  }
  response.hookSpecificOutput = hso

  log('debug', `pre-compact message_count=${event.message_count || 'unknown'}`)

  return response
}
