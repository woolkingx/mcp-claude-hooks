// index.mjs — Event handler dispatcher
// Signature: getHandler(eventName) → handleFn
// O(1) lookup via Map; fallback to default handler

import * as PreToolUse from './PreToolUse.mjs'
import * as PostToolUse from './PostToolUse.mjs'
import * as PermissionRequest from './PermissionRequest.mjs'
import * as UserPromptSubmit from './UserPromptSubmit.mjs'
import * as SessionEnd from './SessionEnd.mjs'
import * as Stop from './Stop.mjs'
import * as StopFailure from './StopFailure.mjs'
import * as SessionStart from './SessionStart.mjs'
import * as Setup from './Setup.mjs'
import * as Notification from './Notification.mjs'
import * as SubagentStart from './SubagentStart.mjs'
import * as SubagentStop from './SubagentStop.mjs'
import * as CwdChanged from './CwdChanged.mjs'
import * as FileChanged from './FileChanged.mjs'
import * as Elicitation from './Elicitation.mjs'
import * as ElicitationResult from './ElicitationResult.mjs'
import * as PreCompact from './PreCompact.mjs'
import * as PostCompact from './PostCompact.mjs'
import * as PostToolUseFailure from './PostToolUseFailure.mjs'
import * as ConfigChange from './ConfigChange.mjs'
import * as InstructionsLoaded from './InstructionsLoaded.mjs'
import * as TaskCreated from './TaskCreated.mjs'
import * as TaskCompleted from './TaskCompleted.mjs'
import * as TeammateIdle from './TeammateIdle.mjs'
import * as WorktreeCreate from './WorktreeCreate.mjs'
import * as WorktreeRemove from './WorktreeRemove.mjs'
import * as DefaultHandler from './default.mjs'

// Event → handler function map
const _handlers = new Map([
  ['PreToolUse', PreToolUse.handle],
  ['PostToolUse', PostToolUse.handle],
  ['PermissionRequest', PermissionRequest.handle],
  ['UserPromptSubmit', UserPromptSubmit.handle],
  ['SessionEnd', SessionEnd.handle],
  ['Stop', Stop.handle],
  ['StopFailure', StopFailure.handle],
  ['SessionStart', SessionStart.handle],
  ['Setup', Setup.handle],
  ['Notification', Notification.handle],
  ['SubagentStart', SubagentStart.handle],
  ['SubagentStop', SubagentStop.handle],
  ['CwdChanged', CwdChanged.handle],
  ['FileChanged', FileChanged.handle],
  ['Elicitation', Elicitation.handle],
  ['ElicitationResult', ElicitationResult.handle],
  ['PreCompact', PreCompact.handle],
  ['PostCompact', PostCompact.handle],
  ['PostToolUseFailure', PostToolUseFailure.handle],
  ['ConfigChange', ConfigChange.handle],
  ['InstructionsLoaded', InstructionsLoaded.handle],
  ['TaskCreated', TaskCreated.handle],
  ['TaskCompleted', TaskCompleted.handle],
  ['TeammateIdle', TeammateIdle.handle],
  ['WorktreeCreate', WorktreeCreate.handle],
  ['WorktreeRemove', WorktreeRemove.handle]
])

export function getHandler(eventName) {
  return _handlers.get(eventName) || DefaultHandler.handle
}
