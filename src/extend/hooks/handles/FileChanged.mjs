// FileChanged.mjs — Handle FileChanged hook events
// ObjectTree-first: build → operate → return

import { ObjectTree } from '../../../lib/schema2object.mjs'

function _noop() {}

export function handle(payload) {
  const { event, schema, log: _log } = payload
  const log = _log || _noop

  // Build response ObjectTree from schema
  const response = new ObjectTree({}, schema.responseSchema, schema.loader)

  response.continue = true

  const hso = { hookEventName: 'FileChanged' }
  response.hookSpecificOutput = hso

  log('debug', `file-changed path=${event.path} change_type=${event.change_type || 'unknown'}`)

  return response
}
