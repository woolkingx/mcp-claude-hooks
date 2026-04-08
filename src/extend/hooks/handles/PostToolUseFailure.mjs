// PostToolUseFailure.mjs — Handle PostToolUseFailure hook events
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

  const hso = { hookEventName: 'PostToolUseFailure' }
  const msg = _resolveMessage(rule, event, featureResult, log)
  if (msg) {
    hso.additionalContext = msg
  }
  response.hookSpecificOutput = hso

  log('debug', `post-tool-use-failure tool_name=${event.tool_name} error=${event.error?.substring(0, 50) || 'none'}`)

  return response
}
