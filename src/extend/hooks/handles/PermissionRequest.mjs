// PermissionRequest.mjs — Handle PermissionRequest hook events
// No permissionDecision field (uses decision instead)
// ObjectTree-first: build → operate → return

import { ObjectTree } from '../../../lib/schema2object.mjs'
import { _resolveMessage, _resolveUpdatedInput } from './_shared.mjs'

function _noop() {}

export function handle(payload) {
  const { rule, event, schema, featureResult, log: _log } = payload
  const log = _log || _noop

  // Build response ObjectTree from schema
  const response = new ObjectTree({}, schema.responseSchema, schema.loader)

  response.continue = true

  // Build decision object then one-shot set (required: behavior)
  const action = rule.action
  const reason = rule.reason
  const decision = { behavior: action === 'deny' ? 'deny' : 'allow' }

  if (action === 'deny') {
    decision.message = reason || 'Denied'
  } else {
    const updated = _resolveUpdatedInput(rule, event, featureResult, log)
    if (updated) decision.updatedInput = updated
  }

  const hso = { hookEventName: 'PermissionRequest', decision }
  response.hookSpecificOutput = hso

  return response
}
