#!/usr/bin/env node
// tests/test-handlers.mjs — per-event handler tests

import { describe, it, assert, loadEventSchema } from './helpers/context.mjs'
import { assertDeny, assertAllow, assertAsk } from './helpers/assertions.mjs'
import { getHandler } from '../src/extend/hooks/handles/index.mjs'
import { Loader } from '../src/lib/schema2object.mjs'

const preToolUseSchema = loadEventSchema('PreToolUse', Loader)
const postToolUseSchema = loadEventSchema('PostToolUse', Loader)
const permReqSchema = loadEventSchema('PermissionRequest', Loader)
const sessionStartSchema = loadEventSchema('SessionStart', Loader)

describe('handlers — PreToolUse', () => {
  it('deny → permissionDecision=deny, continue=false', () => {
    const handler = getHandler('PreToolUse')
    const resp = handler({
      rule: { name: 'test-deny', action: 'deny', reason: 'blocked', enabled: true },
      event: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm foo' } },
      schema: preToolUseSchema
    })
    assertDeny(resp)
    assert.equal(resp.hookSpecificOutput.permissionDecisionReason, 'blocked')
  })

  it('allow → permissionDecision=allow, continue=true', () => {
    const handler = getHandler('PreToolUse')
    const resp = handler({
      rule: { name: 'test-allow', action: 'allow', reason: 'ok', enabled: true },
      event: { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/a.md' } },
      schema: preToolUseSchema
    })
    assertAllow(resp)
  })

  it('ask → permissionDecision=ask, continue=true', () => {
    const handler = getHandler('PreToolUse')
    const resp = handler({
      rule: { name: 'test-ask', action: 'ask', reason: 'confirm?', enabled: true },
      event: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit' } },
      schema: preToolUseSchema
    })
    assertAsk(resp)
  })

  it('test mode → context action, TEST tag in reason', () => {
    const handler = getHandler('PreToolUse')
    const resp = handler({
      rule: { name: 'test-rule', action: 'deny', reason: 'would block', enabled: 'test' },
      event: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm foo' } },
      schema: preToolUseSchema
    })
    assertAllow(resp)
    assert.ok(resp.hookSpecificOutput.permissionDecisionReason.includes('[TEST:'))
  })
})

describe('handlers — PostToolUse', () => {
  it('context → no permissionDecision, continue=true', () => {
    const handler = getHandler('PostToolUse')
    const resp = handler({
      rule: { name: 'test-post', action: 'context', reason: 'info', enabled: true },
      event: { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: {} },
      schema: postToolUseSchema
    })
    assert.equal(resp.continue, true)
    assert.ok(!resp.hookSpecificOutput?.permissionDecision, 'PostToolUse must not have permissionDecision')
    assert.ok(resp.hookSpecificOutput.additionalContext)
  })
})

describe('handlers — PermissionRequest', () => {
  it('deny → decision.behavior=deny', () => {
    const handler = getHandler('PermissionRequest')
    const resp = handler({
      rule: { name: 'test-perm', action: 'deny', reason: 'no', enabled: true },
      event: { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: {} },
      schema: permReqSchema
    })
    assert.equal(resp.hookSpecificOutput.decision.behavior, 'deny')
    assert.ok(!resp.hookSpecificOutput.permissionDecision, 'PermissionRequest must not have permissionDecision')
  })

  it('allow → decision.behavior=allow', () => {
    const handler = getHandler('PermissionRequest')
    const resp = handler({
      rule: { name: 'test-perm-ok', action: 'allow', reason: 'ok', enabled: true },
      event: { hook_event_name: 'PermissionRequest', tool_name: 'Read', tool_input: {} },
      schema: permReqSchema
    })
    assert.equal(resp.hookSpecificOutput.decision.behavior, 'allow')
  })
})

describe('handlers — default handler', () => {
  it('deny → continue=false, reason set', () => {
    const handler = getHandler('SessionStart')
    const resp = handler({
      rule: { name: 'block-it', action: 'deny', reason: 'nope', enabled: true },
      event: { hook_event_name: 'SessionStart' },
      schema: sessionStartSchema
    })
    assert.equal(resp.continue, false)
    assert.ok(resp.reason)
  })

  it('context → continue=true', () => {
    const handler = getHandler('SessionStart')
    const resp = handler({
      rule: { name: 'welcome', action: 'context', reason: 'hello world', enabled: true },
      event: { hook_event_name: 'SessionStart' },
      schema: sessionStartSchema
    })
    assert.equal(resp.continue, true)
  })
})
