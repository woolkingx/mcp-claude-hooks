// WorktreeCreate.mjs — Handle WorktreeCreate hook events
// ObjectTree-first: build → operate → return

import { ObjectTree } from '../../../lib/schema2object.mjs'

function _noop() {}

export function handle(payload) {
  const { event, schema, log: _log } = payload
  const log = _log || _noop

  // Build response ObjectTree from schema
  const response = new ObjectTree({}, schema.responseSchema, schema.loader)

  response.continue = true

  const hso = {
    hookEventName: 'WorktreeCreate',
    worktreePath: event.name || ''
  }
  response.hookSpecificOutput = hso

  log('debug', `worktree-create name=${event.name}`)

  return response
}
