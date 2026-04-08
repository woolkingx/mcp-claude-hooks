#!/usr/bin/env node
// tests/test-s4-objectmodule.mjs — Verify object module pattern + handler structure

import { describe, it, assert, ROOT } from './helpers/context.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('object module — exports', () => {
  it('hook.mjs exports setup', async () => {
    const hook = await import('../src/extend/hooks/hook.mjs')
    assert.equal(typeof hook.setup, 'function')
  })

  it('rules.mjs exports createRules', async () => {
    const rules = await import('../src/extend/hooks/rules/rules.mjs')
    assert.equal(typeof rules.createRules, 'function')
    const r = rules.createRules({}, null)
    assert.equal(typeof r.get, 'function')
    assert.equal(typeof r.reload, 'function')
  })

  it('features.mjs exports createFeatures', async () => {
    const features = await import('../src/extend/hooks/features/features.mjs')
    assert.equal(typeof features.createFeatures, 'function')
    const f = features.createFeatures({}, null, null)
    assert.equal(typeof f.execute, 'function')
    assert.equal(typeof f.list, 'function')
  })

  it('engine.mjs exports createEngine', async () => {
    const engine = await import('../src/extend/hooks/engine/engine.mjs')
    assert.equal(typeof engine.createEngine, 'function')
  })
})

describe('object module — handler structure', () => {
  const handlers = ['PreToolUse', 'PostToolUse', 'PermissionRequest', 'UserPromptSubmit', 'SessionEnd', 'default']

  it('all handlers export handle function', async () => {
    for (const h of handlers) {
      const mod = await import(`../src/extend/hooks/handles/${h}.mjs`)
      assert.equal(typeof mod.handle, 'function', `${h}.mjs missing handle export`)
    }
  })

  it('handlers import ObjectTree from schema2object', () => {
    for (const h of handlers) {
      const src = readFileSync(join(ROOT, `src/extend/hooks/handles/${h}.mjs`), 'utf-8')
      assert.ok(src.includes('ObjectTree'), `${h}.mjs doesn't use ObjectTree`)
    }
  })

  it('no handler imports from server/features', () => {
    for (const h of handlers) {
      const src = readFileSync(join(ROOT, `src/extend/hooks/handles/${h}.mjs`), 'utf-8')
      assert.ok(!src.includes('server/features'), `${h}.mjs still imports from server/features`)
    }
  })
})

describe('object module — import paths', () => {
  it('hook-match.mjs imports from correct path', () => {
    // Canonical location is L1 lib/hook-match.mjs; engine re-exports from there
    const src = readFileSync(join(ROOT, 'src/lib/hook-match.mjs'), 'utf-8')
    assert.ok(src.includes('./schema2object.mjs'))
    assert.ok(src.includes('./bash-parser.mjs'))
    // Engine shim re-exports from canonical L1 location
    const shim = readFileSync(join(ROOT, 'src/extend/hooks/engine/hook-match.mjs'), 'utf-8')
    assert.ok(shim.includes('../../../lib/hook-match.mjs'))
  })

  it('engine.mjs receives rules/features as deps', () => {
    const src = readFileSync(join(ROOT, 'src/extend/hooks/engine/engine.mjs'), 'utf-8')
    assert.ok(src.includes('createEngine({'))
    assert.ok(src.includes('rules.get(eventName)'))
  })

  it('_shared.mjs accepts featureResult param', () => {
    const src = readFileSync(join(ROOT, 'src/extend/hooks/handles/_shared.mjs'), 'utf-8')
    assert.ok(src.includes('featureResult'), '_shared.mjs missing featureResult param')
  })
})
