#!/usr/bin/env node
// tests/test-engine.mjs — engine.processEvent unit tests

import { describe, it, assert, mockBus, ROOT } from './helpers/context.mjs'
import { createEngine } from '../src/extend/hooks/engine/engine.mjs'
import { Loader } from '../src/lib/schema2object.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONFIG_DIR = join(ROOT, 'src', 'project', 'config')
const configSchema = JSON.parse(readFileSync(join(CONFIG_DIR, 'config.json'), 'utf-8'))
const loader = new Loader(configSchema, CONFIG_DIR)

// --- Mock factories ---

function mockRules(map = {}) {
  return {
    get(event) { return map[event] || [] },
    reload() {}
  }
}

function mockFeatures(results = {}) {
  return {
    execute(feature, event) { return results[feature?.name || feature] || null },
    list() { return Object.keys(results) }
  }
}

function mockState() {
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

function makeEngine(opts = {}) {
  const bus = mockBus()
  return createEngine({
    rules: opts.rules || mockRules(),
    features: opts.features || mockFeatures(),
    state: opts.state || mockState(),
    config: {},
    projectRoot: opts.projectRoot || ROOT,
    bus,
    loader
  })
}

describe('engine — processEvent', () => {
  it('no candidates → null', async () => {
    const engine = makeEngine()
    const result = await engine.processEvent({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} })
    assert.equal(result, null)
  })

  it('all match miss → null', async () => {
    const engine = makeEngine({
      rules: mockRules({
        PreToolUse: [
          { name: 'only-bash', event: 'PreToolUse', action: 'deny', reason: 'no', enabled: true,
            match: { properties: { tool_name: { const: 'Bash' } } } }
        ]
      })
    })
    const result = await engine.processEvent({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} })
    assert.equal(result, null)
  })

  it('deny rule → deny response', async () => {
    const engine = makeEngine({
      rules: mockRules({
        PreToolUse: [
          { name: 'deny-all', event: 'PreToolUse', action: 'deny', reason: 'blocked', enabled: true,
            match: { properties: { tool_name: { const: 'Bash' } } } }
        ]
      })
    })
    const result = await engine.processEvent({
      hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }
    })
    assert.ok(result)
    assert.equal(result.continue, false)
    assert.equal(result.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('dedup: repeat=false second time → skip DEDUP_ACTIONS', async () => {
    const state = mockState()
    const engine = makeEngine({
      state,
      rules: mockRules({
        SessionStart: [
          { name: 'welcome', event: 'SessionStart', action: 'context', reason: 'hi', enabled: true, repeat: false }
        ]
      })
    })
    const event = { hook_event_name: 'SessionStart', session_id: 's1' }
    const r1 = await engine.processEvent(event)
    assert.ok(r1, 'first call should produce result')
    const r2 = await engine.processEvent(event)
    assert.equal(r2, null, 'second call should be deduped (context is DEDUP_ACTION)')
  })

  it('dedup: repeat=false non-DEDUP_ACTIONS → still fire', async () => {
    const state = mockState()
    const engine = makeEngine({
      state,
      rules: mockRules({
        PreToolUse: [
          { name: 'deny-bash', event: 'PreToolUse', action: 'deny', reason: 'no', enabled: true, repeat: false,
            match: { properties: { tool_name: { const: 'Bash' } } } }
        ]
      })
    })
    const event = { hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 's1', tool_input: { command: 'ls' } }
    const r1 = await engine.processEvent(event)
    assert.ok(r1)
    assert.equal(r1.hookSpecificOutput.permissionDecision, 'deny')
    // deny is NOT in DEDUP_ACTIONS, so second call should still fire
    const r2 = await engine.processEvent(event)
    assert.ok(r2)
    assert.equal(r2.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('feature fn call → featureResult passed to handler', async () => {
    const engine = makeEngine({
      features: mockFeatures({ 'test-feature': 'feature-output-value' }),
      rules: mockRules({
        PreToolUse: [
          { name: 'with-feature', event: 'PreToolUse', action: 'context', reason: 'info', enabled: true,
            feature: { name: 'test-feature' },
            match: { properties: { tool_name: { const: 'Bash' } } } }
        ]
      })
    })
    const result = await engine.processEvent({
      hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }
    })
    assert.ok(result)
    assert.equal(result.continue, true)
  })

  it('unknown event name → null', async () => {
    const engine = makeEngine()
    const result = await engine.processEvent({ hook_event_name: 'FakeEvent' })
    assert.equal(result, null)
  })

  it('missing hook_event_name → null', async () => {
    const engine = makeEngine()
    const result = await engine.processEvent({ tool_name: 'Bash' })
    assert.equal(result, null)
  })
})
