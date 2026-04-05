// PreToolUse.mjs — Handle PreToolUse hook events
// Signature: handle(payload) → response ObjectTree
// payload = { rule, event, schema, featureResult, log }
// ObjectTree-first: build → operate → return

import { ObjectTree } from '../../../lib/schema2object.mjs'
import { _resolveMessage, _resolveUpdatedInput } from './_shared.mjs'

function _mapActionToDecision(action) {
  if (action === 'deny') return 'deny'
  if (action === 'ask') return 'ask'
  return 'allow'
}

function _noop() {}

export function handle(payload) {
  const { rule, event, schema, featureResult, log: _log } = payload
  const log = _log || _noop

  // Build response ObjectTree from schema
  const response = new ObjectTree({}, schema.responseSchema, schema.loader)

  // Determine action
  const isTest = rule.enabled === 'test'
  const action = isTest ? 'context' : rule.action
  const reason = isTest
    ? `[TEST:${rule.name}] would ${rule.action}: ${rule.reason || 'no reason'}`
    : rule.reason

  // Set continue
  response.continue = action !== 'deny'

  // Build HSO then one-shot set (required: hookEventName)
  const hso = { hookEventName: 'PreToolUse', permissionDecision: _mapActionToDecision(action) }
  if (reason) hso.permissionDecisionReason = reason
  if (action === 'context' && reason) hso.additionalContext = reason
  if (action !== 'deny' && action !== 'ask') {
    const updated = _resolveUpdatedInput(rule, event, featureResult, log)
    if (updated) hso.updatedInput = updated
  }
  response.hookSpecificOutput = hso

  return response
}
