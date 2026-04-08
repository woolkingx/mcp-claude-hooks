// ElicitationResult.mjs — Handle ElicitationResult hook events
// ObjectTree-first: build → operate → return

import { ObjectTree } from '../../../lib/schema2object.mjs'

function _noop() {}

export function handle(payload) {
  const { event, schema, log: _log } = payload
  const log = _log || _noop

  // Build response ObjectTree from schema
  const response = new ObjectTree({}, schema.responseSchema, schema.loader)

  response.continue = true

  const hso = { hookEventName: 'ElicitationResult' }
  response.hookSpecificOutput = hso

  log('debug', `elicitation-result action=${event.action || 'none'} request_id=${event.request_id || 'none'}`)

  return response
}
