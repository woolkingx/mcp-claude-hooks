#!/usr/bin/env node
// tests/test-merger.mjs — merge: empty/single/priority/immutable

import { describe, it, assert } from './helpers/context.mjs'
import { merge } from '../src/extend/hooks/engine/merger.mjs'

describe('merger — merge', () => {
  it('empty → null', () => {
    assert.equal(merge([], {}), null)
  })

  it('single → deep clone', () => {
    const original = { continue: true, hookSpecificOutput: { permissionDecision: 'allow', hookEventName: 'PreToolUse' } }
    const resp = { $toDict: () => original, hookSpecificOutput: original.hookSpecificOutput, continue: original.continue }
    const result = merge([{ resp, rule: { name: 'r1', action: 'allow' } }], {})
    assert.deepEqual(result, original)
    // verify deep clone — mutation of result should not affect original
    result.hookSpecificOutput.permissionDecision = 'deny'
    assert.equal(original.hookSpecificOutput.permissionDecision, 'allow', 'merge must deep clone')
  })

  it('deny > allow (priority)', () => {
    const denyResp = {
      continue: false,
      hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'blocked' },
      $toDict() { return { continue: false, hookSpecificOutput: { ...this.hookSpecificOutput } } }
    }
    const allowResp = {
      continue: true,
      hookSpecificOutput: { permissionDecision: 'allow' },
      $toDict() { return { continue: true, hookSpecificOutput: { ...this.hookSpecificOutput } } }
    }
    const log = () => {}
    const result = merge([
      { resp: allowResp, rule: { name: 'r-allow', action: 'allow' } },
      { resp: denyResp, rule: { name: 'r-deny', action: 'deny' } }
    ], log)
    assert.equal(result.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('does not mutate original responses', () => {
    const resp1 = {
      continue: false,
      hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'orig1' },
      $toDict() { return { continue: false, hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'orig1' } } }
    }
    const resp2 = {
      continue: false,
      hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'orig2' },
      $toDict() { return { continue: false, hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'orig2' } } }
    }
    const log = () => {}
    merge([
      { resp: resp1, rule: { name: 'r1', action: 'deny' } },
      { resp: resp2, rule: { name: 'r2', action: 'deny' } }
    ], log)
    assert.equal(resp1.hookSpecificOutput.permissionDecisionReason, 'orig1', 'merge mutated original resp1')
    assert.equal(resp2.hookSpecificOutput.permissionDecisionReason, 'orig2', 'merge mutated original resp2')
  })
})
