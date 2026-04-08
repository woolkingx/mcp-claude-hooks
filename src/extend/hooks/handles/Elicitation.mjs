// Elicitation.mjs — Handle Elicitation hook events
// ObjectTree-first: build → operate → return

import { ObjectTree } from '../../../lib/schema2object.mjs'

function _noop() {}

export function handle(payload) {
  const { event, schema, log: _log } = payload
  const log = _log || _noop

  // Build response ObjectTree from schema
  const response = new ObjectTree({}, schema.responseSchema, schema.loader)

  response.continue = true

  const hso = { hookEventName: 'Elicitation' }
  response.hookSpecificOutput = hso

  log('debug', `elicitation name=${event.name || 'none'} mcp_server=${event.mcp_server || 'none'}`)

  return response
}
