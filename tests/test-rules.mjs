#!/usr/bin/env node
// tests/test-rules.mjs — createRules: get/reload/sort/filter

import { describe, it, assert, ROOT } from './helpers/context.mjs'
import { createRules } from '../src/extend/hooks/rules/rules.mjs'

const config = { projectRoot: ROOT, rulesDir: 'rules' }
const rules = createRules(config, null)

describe('rules — createRules', () => {
  it('returns object with get/reload', () => {
    assert.equal(typeof rules.get, 'function')
    assert.equal(typeof rules.reload, 'function')
  })

  it('get returns rules for PreToolUse', () => {
    const ruleList = rules.get('PreToolUse')
    assert.ok(Array.isArray(ruleList))
    assert.ok(ruleList.length > 0, `expected >0 PreToolUse rules, got ${ruleList.length}`)
  })

  it('get — unknown event returns empty', () => {
    const ruleList = rules.get('NonExistentEvent')
    assert.ok(Array.isArray(ruleList))
    assert.equal(ruleList.length, 0)
  })

  it('get — rules sorted by priority', () => {
    const ruleList = rules.get('PreToolUse')
    if (ruleList.length >= 2) {
      for (let i = 1; i < ruleList.length; i++) {
        assert.ok((ruleList[i - 1].priority ?? 50) <= (ruleList[i].priority ?? 50),
          `priority not sorted: ${ruleList[i - 1].name}(${ruleList[i - 1].priority}) > ${ruleList[i].name}(${ruleList[i].priority})`)
      }
    }
  })

  it('get — disabled rules excluded', () => {
    const ruleList = rules.get('PreToolUse')
    for (const r of ruleList) {
      assert.notEqual(r.enabled, false, `disabled rule found: ${r.name}`)
    }
  })

  it('reload rebuilds cache', () => {
    rules.reload()
    const ruleList = rules.get('PreToolUse')
    assert.ok(ruleList.length > 0, 'rules empty after reload')
  })
})
