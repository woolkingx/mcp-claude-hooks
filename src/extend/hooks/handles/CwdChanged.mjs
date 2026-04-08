// CwdChanged.mjs — Handle CwdChanged hook events
// ObjectTree-first: build → operate → return

import { ObjectTree } from '../../../lib/schema2object.mjs'

function _noop() {}

export function handle(payload) {
  const { event, schema, log: _log } = payload
  const log = _log || _noop

  // Build response ObjectTree from schema
  const response = new ObjectTree({}, schema.responseSchema, schema.loader)

  response.continue = true

  const hso = { hookEventName: 'CwdChanged' }
  response.hookSpecificOutput = hso

  log('debug', `cwd-changed old_cwd=${event.old_cwd} new_cwd=${event.new_cwd}`)

  return response
}
