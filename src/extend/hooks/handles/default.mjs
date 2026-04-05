// default.mjs — Default handler for events without specific handlers
// Handles: SessionStart, Setup, SubagentStart, Notification, PostToolUseFailure, etc.
// Uses HSO additionalContext when schema supports it, otherwise systemMessage.
// ObjectTree-first: build → operate → return

import { ObjectTree } from '../../../lib/schema2object.mjs'
import { _resolveMessage } from './_shared.mjs'

function _noop() {}

export function handle(payload) {
  const { rule, event, schema, featureResult, log: _log } = payload
  const log = _log || _noop

  // Build response ObjectTree from schema — Loader auto-resolves $ref
  const response = new ObjectTree({}, schema.responseSchema, schema.loader)

  const action = rule.action
  const reason = rule.reason

  // Set continue
  response.continue = action !== 'deny'

  if (action === 'deny') {
    response.reason = reason || `Blocked by rule: ${rule.name}`
  } else {
    const msg = _resolveMessage(rule, event, featureResult, log)
    if (msg) {
      // Try HSO first (schema validates), fallback to systemMessage
      try {
        response.hookSpecificOutput = { hookEventName: event.hook_event_name, additionalContext: msg }
      } catch {
        response.systemMessage = msg
      }
    }
  }

  return response
}
