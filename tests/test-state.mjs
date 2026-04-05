#!/usr/bin/env node
// tests/test-state.mjs — hook state dedup module tests

import { describe, it, assert, freshDir } from './helpers/context.mjs'
import { createState } from '../src/extend/hooks/engine/state.mjs'

describe('state — hasFired / markFired', () => {
  it('hasFired false initially', () => {
    const state = createState({ projectRoot: freshDir() }, null)
    assert.equal(state.hasFired('s1', 'r1', false), false)
  })

  it('markFired → hasFired true (repeat:false)', () => {
    const state = createState({ projectRoot: freshDir() }, null)
    assert.equal(state.hasFired('s1', 'r1', false), false)
    state.markFired('s1', 'r1')
    assert.equal(state.hasFired('s1', 'r1', false), true)
  })

  it('repeat:true always returns false', () => {
    const state = createState({ projectRoot: freshDir() }, null)
    state.markFired('s1', 'r1')
    assert.equal(state.hasFired('s1', 'r1', true), false)
  })

  it('repeat:undefined always returns false', () => {
    const state = createState({ projectRoot: freshDir() }, null)
    state.markFired('s1', 'r1')
    assert.equal(state.hasFired('s1', 'r1', undefined), false)
  })
})

describe('state — cooldown', () => {
  it('hasFired false after cooldown expires', () => {
    const state = createState({ projectRoot: freshDir() }, null)
    assert.equal(state.hasFired('s2', 'r2', 1), false)
    state.markFired('s2', 'r2')
    assert.equal(state.hasFired('s2', 'r2', 1), true)
    const start = Date.now()
    while (Date.now() - start < 1100) { /* busy wait */ }
    assert.equal(state.hasFired('s2', 'r2', 1), false)
  })
})

describe('state — clearSession', () => {
  it('clearSession removes entries', () => {
    const state = createState({ projectRoot: freshDir() }, null)
    state.markFired('s3', 'r3')
    assert.equal(state.hasFired('s3', 'r3', false), true)
    state.clearSession('s3')
    assert.equal(state.hasFired('s3', 'r3', false), false)
  })
})

describe('state — dump / restore', () => {
  it('dump + restore round trip', () => {
    const dir = freshDir()
    const state1 = createState({ projectRoot: dir })
    state1.markFired('s4', 'r4a')
    state1.markFired('s4', 'r4b')
    state1.markFired('s5', 'r5')
    const dumped = state1.dump()

    const state2 = createState({ projectRoot: dir })
    state2.restore(dumped)
    assert.equal(state2.hasFired('s4', 'r4a', false), true)
    assert.equal(state2.hasFired('s4', 'r4b', false), true)
    assert.equal(state2.hasFired('s5', 'r5', false), true)
  })
})
