#!/usr/bin/env node
// tests/test-handlers.mjs — per-event handler tests

import { describe, it, assert, loadEventSchema } from './helpers/context.mjs'
import { assertSchemaDeny, assertSchemaAllow, assertSchemaAsk, assertSchemaContext, assertValidResponse, buildMinimalEvent } from './helpers/schema-assert.mjs'
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
      event: buildMinimalEvent('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm foo' } }),
      schema: preToolUseSchema
    })
    const dict = resp.$toDict ? resp.$toDict() : resp
    assertSchemaDeny('PreToolUse', dict)
    assert.equal(dict.hookSpecificOutput.permissionDecision, 'deny')
    assert.equal(dict.hookSpecificOutput.permissionDecisionReason, 'blocked')
  })

  it('allow → permissionDecision=allow, continue=true', () => {
    const handler = getHandler('PreToolUse')
    const resp = handler({
      rule: { name: 'test-allow', action: 'allow', reason: 'ok', enabled: true },
      event: buildMinimalEvent('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/a.md' } }),
      schema: preToolUseSchema
    })
    const dict = resp.$toDict ? resp.$toDict() : resp
    assertSchemaAllow('PreToolUse', dict)
  })

  it('ask → permissionDecision=ask, continue=true', () => {
    const handler = getHandler('PreToolUse')
    const resp = handler({
      rule: { name: 'test-ask', action: 'ask', reason: 'confirm?', enabled: true },
      event: buildMinimalEvent('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git commit' } }),
      schema: preToolUseSchema
    })
    const dict = resp.$toDict ? resp.$toDict() : resp
    assertSchemaAsk('PreToolUse', dict)
  })

  it('test mode → context action, TEST tag in reason', () => {
    const handler = getHandler('PreToolUse')
    const resp = handler({
      rule: { name: 'test-rule', action: 'deny', reason: 'would block', enabled: 'test' },
      event: buildMinimalEvent('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm foo' } }),
      schema: preToolUseSchema
    })
    const dict = resp.$toDict ? resp.$toDict() : resp
    assertSchemaAllow('PreToolUse', dict)
    assert.ok(dict.hookSpecificOutput.permissionDecisionReason.includes('[TEST:'))
  })
})

describe('handlers — PostToolUse', () => {
  it('context → no permissionDecision, continue=true', () => {
    const handler = getHandler('PostToolUse')
    const resp = handler({
      rule: { name: 'test-post', action: 'context', reason: 'info', enabled: true },
      event: buildMinimalEvent('PostToolUse', { tool_name: 'Write', tool_input: {}, tool_response: '' }),
      schema: postToolUseSchema
    })
    const dict = resp.$toDict ? resp.$toDict() : resp
    assertSchemaContext('PostToolUse', dict)
    assert.ok(!dict.hookSpecificOutput?.permissionDecision, 'PostToolUse must not have permissionDecision')
  })
})

describe('handlers — PermissionRequest', () => {
  it('deny → decision.behavior=deny', () => {
    const handler = getHandler('PermissionRequest')
    const resp = handler({
      rule: { name: 'test-perm', action: 'deny', reason: 'no', enabled: true },
      event: buildMinimalEvent('PermissionRequest', { tool_name: 'Bash', tool_input: {} }),
      schema: permReqSchema
    })
    const dict = resp.$toDict ? resp.$toDict() : resp
    assertValidResponse('PermissionRequest', dict)
    assert.equal(dict.hookSpecificOutput.decision.behavior, 'deny')
    assert.ok(!dict.hookSpecificOutput.permissionDecision, 'PermissionRequest must not have permissionDecision')
  })

  it('allow → decision.behavior=allow', () => {
    const handler = getHandler('PermissionRequest')
    const resp = handler({
      rule: { name: 'test-perm-ok', action: 'allow', reason: 'ok', enabled: true },
      event: buildMinimalEvent('PermissionRequest', { tool_name: 'Read', tool_input: {} }),
      schema: permReqSchema
    })
    const dict = resp.$toDict ? resp.$toDict() : resp
    assertValidResponse('PermissionRequest', dict)
    assert.equal(dict.hookSpecificOutput.decision.behavior, 'allow')
  })
})

describe('handlers — default handler', () => {
  it('deny → continue=false, reason set', () => {
    const handler = getHandler('SessionStart')
    const resp = handler({
      rule: { name: 'block-it', action: 'deny', reason: 'nope', enabled: true },
      event: buildMinimalEvent('SessionStart'),
      schema: sessionStartSchema
    })
    const dict = resp.$toDict ? resp.$toDict() : resp
    assertSchemaDeny('SessionStart', dict)
    assert.ok(dict.reason)
  })

  it('context → continue=true', () => {
    const handler = getHandler('SessionStart')
    const resp = handler({
      rule: { name: 'welcome', action: 'context', reason: 'hello world', enabled: true },
      event: buildMinimalEvent('SessionStart'),
      schema: sessionStartSchema
    })
    const dict = resp.$toDict ? resp.$toDict() : resp
    assertSchemaContext('SessionStart', dict)
  })
})
