// SessionStart.mjs — Handle SessionStart hook events
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

  const msg = _resolveMessage(rule, event, featureResult, log)
  const hso = { hookEventName: 'SessionStart' }
  if (msg) {
    hso.additionalContext = msg
  }
  response.hookSpecificOutput = hso
  if (rule.action === 'deny' && rule.reason) {
    response.reason = rule.reason
  }

  log('debug', `session-start source=${event.source} model=${event.model || 'none'}`)

  return response
}
