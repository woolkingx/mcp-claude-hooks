// UserPromptSubmit.mjs — Handle UserPromptSubmit hook events
// Only systemMessage allowed; always continue=true
// ObjectTree-first: build → operate → return
//
// Agent inject: featureResult (string from agent.collect) → additionalContext
// Other features/rules: _resolveMessage → systemMessage

import { ObjectTree } from '../../../lib/schema2object.mjs'
import { _resolveMessage } from './_shared.mjs'

function _noop() {}

export function handle(payload) {
  const { rule, event, schema, featureResult, log: _log } = payload
  const log = _log || _noop

  // Build response ObjectTree from schema
  const response = new ObjectTree({}, schema.responseSchema, schema.loader)

  response.continue = true

  // Build HSO
  const hso = { hookEventName: 'UserPromptSubmit' }

  // Feature inject mode: featureResult string → additionalContext (not systemMessage)
  // This handles agent.collect() output and any future feature that returns context strings
  const featureConfig = rule.feature?.config || rule.feature || {}
  if (featureResult && typeof featureResult === 'string' && featureConfig.mode === 'inject') {
    hso.additionalContext = featureResult
    log('info', `feature:inject → additionalContext len=${featureResult.length}`)
  } else {
    // Normal path: reason / load / feature → systemMessage
    const msg = _resolveMessage(rule, event, featureResult, log)
    if (msg) {
      response.systemMessage = msg
    }
  }

  response.hookSpecificOutput = hso

  return response
}
