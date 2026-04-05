// index.mjs — Event handler dispatcher
// Signature: getHandler(eventName) → handleFn
// O(1) lookup via Map; fallback to default handler

import * as PreToolUse from './PreToolUse.mjs'
import * as PostToolUse from './PostToolUse.mjs'
import * as PermissionRequest from './PermissionRequest.mjs'
import * as UserPromptSubmit from './UserPromptSubmit.mjs'
import * as SessionEnd from './SessionEnd.mjs'
import * as DefaultHandler from './default.mjs'

// Event → handler function map
const _handlers = new Map([
  ['PreToolUse', PreToolUse.handle],
  ['PostToolUse', PostToolUse.handle],
  ['PermissionRequest', PermissionRequest.handle],
  ['UserPromptSubmit', UserPromptSubmit.handle],
  ['SessionEnd', SessionEnd.handle]
])

export function getHandler(eventName) {
  return _handlers.get(eventName) || DefaultHandler.handle
}
