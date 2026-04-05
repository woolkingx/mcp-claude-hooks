// SessionEnd.mjs — Handle SessionEnd hook events
// ObjectTree-first: build → operate → return

import { ObjectTree } from '../../../lib/schema2object.mjs'

function _noop() {}

export function handle(payload) {
  const { event, schema, log: _log } = payload
  const log = _log || _noop

  // Build response ObjectTree from schema
  const response = new ObjectTree({}, schema.responseSchema, schema.loader)

  response.continue = true

  // Build HSO then one-shot set
  const hso = { hookEventName: 'SessionEnd' }
  response.hookSpecificOutput = hso

  log('debug', `session end session=${event.session_id || 'none'}`)

  return response
}
