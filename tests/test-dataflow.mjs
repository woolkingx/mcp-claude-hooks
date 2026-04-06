#!/usr/bin/env node
// tests/test-dataflow.mjs — End-to-end schema pipeline validation
// Validates: event input → engine → match → handler → response output
// Every boundary checked with ObjectTree (schema2object IS the validator)

import { describe, it, assert, mockBus, ROOT } from './helpers/context.mjs'
import {
  assertValidEvent, assertValidResponse, assertSchemaDeny,
  buildMinimalEvent
} from './helpers/schema-assert.mjs'
import { createEngine } from '../src/extend/hooks/engine/engine.mjs'
import { Loader } from '../src/lib/schema2object.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONFIG_DIR = join(ROOT, 'src', 'project', 'config')
const configSchema = JSON.parse(readFileSync(join(CONFIG_DIR, 'config.json'), 'utf-8'))
const loader = new Loader(configSchema, CONFIG_DIR)

// --- Mock factories (same as test-engine) ---

function _mockRules(map = {}) {
  return {
    get(event) { return map[event] || [] },
    reload() {}
  }
}

function _mockFeatures(results = {}) {
  return {
    execute(feature, event) { return results[feature?.name || feature] || null },
    list() { return Object.keys(results) }
  }
}

function _mockState() {
  const fired = new Map()
  return {
    hasFired(sid, name, repeat) {
      if (repeat === true || repeat === undefined) return false
      return fired.has(`${sid}:${name}`)
    },
    markFired(sid, name) { fired.set(`${sid}:${name}`, Date.now()) },
    clearSession(sid) { for (const k of fired.keys()) { if (k.startsWith(sid + ':')) fired.delete(k) } },
    dump() { return Object.fromEntries(fired) },
    restore(d) { for (const [k, v] of Object.entries(d)) fired.set(k, v) }
  }
}

function _makeEngine(rulesMap = {}, features = {}) {
  return createEngine({
    rules: _mockRules(rulesMap),
    features: _mockFeatures(features),
    state: _mockState(),
    config: {},
    projectRoot: ROOT,
    bus: mockBus(),
    loader
  })
}

// --- Events with registered handlers ---
// PreToolUse, PostToolUse, PermissionRequest, UserPromptSubmit → specific handlers
// SessionStart → default handler

const TOOL_EVENTS = ['PreToolUse', 'PostToolUse', 'PermissionRequest']
const NON_TOOL_EVENTS = ['SessionStart', 'UserPromptSubmit']
const ALL_EVENTS = [...TOOL_EVENTS, ...NON_TOOL_EVENTS]

// Extra required fields per event beyond buildMinimalEvent defaults
const EVENT_EXTRAS = {
  PreToolUse: { tool_name: 'Bash', tool_input: { command: 'test' } },
  PostToolUse: { tool_name: 'Write', tool_input: {}, tool_response: 'ok' },
  PermissionRequest: { tool_name: 'Bash', tool_input: {} },
  SessionStart: {},
  UserPromptSubmit: { prompt: 'hello' }
}

describe('dataflow — buildMinimalEvent schema compliance', () => {
  for (const eventName of ALL_EVENTS) {
    it(`${eventName}: buildMinimalEvent produces schema-valid input`, () => {
      const event = buildMinimalEvent(eventName, EVENT_EXTRAS[eventName])
      assertValidEvent(eventName, event)
    })
  }
})

// Per-handler deny semantics:
// PreToolUse: continue=false, permissionDecision=deny
// PostToolUse: continue=true always (post-hook, context only)
// PermissionRequest: continue=true, decision.behavior=deny
// SessionStart: continue=false (default handler)
// UserPromptSubmit: continue=true always (context only)

describe('dataflow — deny rule → schema-valid deny response', () => {
  it('PreToolUse: deny → continue=false, schema-valid', async () => {
    const event = buildMinimalEvent('PreToolUse', EVENT_EXTRAS.PreToolUse)
    assertValidEvent('PreToolUse', event)
    const engine = _makeEngine({
      PreToolUse: [
        { name: 'deny-pre', event: 'PreToolUse', action: 'deny', reason: 'blocked', enabled: true,
          match: { properties: { tool_name: { const: 'Bash' } } } }
      ]
    })
    const result = await engine.processEvent(event)
    assert.ok(result)
    assertSchemaDeny('PreToolUse', result)
    assert.equal(result.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('PostToolUse: deny → continue=true (post-hook ignores deny), schema-valid', async () => {
    const event = buildMinimalEvent('PostToolUse', EVENT_EXTRAS.PostToolUse)
    assertValidEvent('PostToolUse', event)
    const engine = _makeEngine({
      PostToolUse: [
        { name: 'deny-post', event: 'PostToolUse', action: 'deny', reason: 'blocked', enabled: true,
          match: { properties: { tool_name: { const: 'Write' } } } }
      ]
    })
    const result = await engine.processEvent(event)
    assert.ok(result)
    assertValidResponse('PostToolUse', result)
    assert.equal(result.continue, true, 'PostToolUse always continues')
  })

  it('PermissionRequest: deny → decision.behavior=deny, continue=true, schema-valid', async () => {
    const event = buildMinimalEvent('PermissionRequest', EVENT_EXTRAS.PermissionRequest)
    assertValidEvent('PermissionRequest', event)
    const engine = _makeEngine({
      PermissionRequest: [
        { name: 'deny-perm', event: 'PermissionRequest', action: 'deny', reason: 'blocked', enabled: true,
          match: { properties: { tool_name: { const: 'Bash' } } } }
      ]
    })
    const result = await engine.processEvent(event)
    assert.ok(result)
    assertValidResponse('PermissionRequest', result)
    assert.equal(result.continue, true, 'PermissionRequest always continues')
    assert.equal(result.hookSpecificOutput.decision.behavior, 'deny')
  })

  it('SessionStart: deny → continue=false, schema-valid', async () => {
    const event = buildMinimalEvent('SessionStart', EVENT_EXTRAS.SessionStart)
    assertValidEvent('SessionStart', event)
    const engine = _makeEngine({
      SessionStart: [
        { name: 'deny-ss', event: 'SessionStart', action: 'deny', reason: 'blocked', enabled: true }
      ]
    })
    const result = await engine.processEvent(event)
    assert.ok(result)
    assertSchemaDeny('SessionStart', result)
  })

  it('UserPromptSubmit: deny → continue=true (prompt-only), schema-valid', async () => {
    const event = buildMinimalEvent('UserPromptSubmit', EVENT_EXTRAS.UserPromptSubmit)
    assertValidEvent('UserPromptSubmit', event)
    const engine = _makeEngine({
      UserPromptSubmit: [
        { name: 'deny-ups', event: 'UserPromptSubmit', action: 'deny', reason: 'blocked', enabled: true }
      ]
    })
    const result = await engine.processEvent(event)
    assert.ok(result)
    assertValidResponse('UserPromptSubmit', result)
    assert.equal(result.continue, true, 'UserPromptSubmit always continues')
  })
})

describe('dataflow — context rule → schema-valid context response', () => {
  for (const eventName of TOOL_EVENTS) {
    it(`${eventName}: context → schema-valid response`, async () => {
      const event = buildMinimalEvent(eventName, EVENT_EXTRAS[eventName])

      const engine = _makeEngine({
        [eventName]: [
          { name: `ctx-${eventName}`, event: eventName, action: 'context', reason: 'info here', enabled: true,
            match: { properties: { tool_name: { const: event.tool_name } } } }
        ]
      })
      const result = await engine.processEvent(event)
      assert.ok(result, `${eventName} context should produce result`)
      assertValidResponse(eventName, result)
      assert.equal(result.continue, true)
    })
  }

  for (const eventName of NON_TOOL_EVENTS) {
    it(`${eventName}: context → schema-valid response`, async () => {
      const event = buildMinimalEvent(eventName, EVENT_EXTRAS[eventName])

      const engine = _makeEngine({
        [eventName]: [
          { name: `ctx-${eventName}`, event: eventName, action: 'context', reason: 'info here', enabled: true }
        ]
      })
      const result = await engine.processEvent(event)
      assert.ok(result, `${eventName} context should produce result`)
      assertValidResponse(eventName, result)
      assert.equal(result.continue, true)
    })
  }
})

describe('dataflow — multiple rules merge → schema-valid', () => {
  it('PreToolUse: deny + allow merge → deny wins, schema-valid', async () => {
    const event = buildMinimalEvent('PreToolUse', EVENT_EXTRAS.PreToolUse)

    const engine = _makeEngine({
      PreToolUse: [
        { name: 'allow-rule', event: 'PreToolUse', action: 'allow', reason: 'ok', enabled: true, priority: 10,
          match: { properties: { tool_name: { const: 'Bash' } } } },
        { name: 'deny-rule', event: 'PreToolUse', action: 'deny', reason: 'no', enabled: true, priority: 90,
          match: { properties: { tool_name: { const: 'Bash' } } } }
      ]
    })
    const result = await engine.processEvent(event)
    assert.ok(result)
    assertSchemaDeny('PreToolUse', result)
  })

  it('SessionStart: context + context merge → schema-valid', async () => {
    const event = buildMinimalEvent('SessionStart', EVENT_EXTRAS.SessionStart)

    const engine = _makeEngine({
      SessionStart: [
        { name: 'welcome-a', event: 'SessionStart', action: 'context', reason: 'hello', enabled: true },
        { name: 'welcome-b', event: 'SessionStart', action: 'context', reason: 'world', enabled: true }
      ]
    })
    const result = await engine.processEvent(event)
    assert.ok(result)
    assertValidResponse('SessionStart', result)
    assert.equal(result.continue, true)
  })
})

describe('dataflow — feature integration → schema-valid', () => {
  it('PreToolUse: feature result feeds into context response', async () => {
    const event = buildMinimalEvent('PreToolUse', EVENT_EXTRAS.PreToolUse)

    const engine = _makeEngine(
      {
        PreToolUse: [
          { name: 'feat-rule', event: 'PreToolUse', action: 'context', reason: 'feat', enabled: true,
            feature: { name: 'test-feat' },
            match: { properties: { tool_name: { const: 'Bash' } } } }
        ]
      },
      { 'test-feat': 'feature says hello' }
    )
    const result = await engine.processEvent(event)
    assert.ok(result)
    assertValidResponse('PreToolUse', result)
    assert.equal(result.continue, true)
  })
})

describe('dataflow — no match → null (no schema violation possible)', () => {
  for (const eventName of ALL_EVENTS) {
    it(`${eventName}: no rules → null`, async () => {
      const event = buildMinimalEvent(eventName, EVENT_EXTRAS[eventName])
      const engine = _makeEngine()
      const result = await engine.processEvent(event)
      assert.equal(result, null)
    })
  }
})
