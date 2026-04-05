#!/usr/bin/env node
// tests/test-features.mjs — createFeatures: execute/list/unknown

import { describe, it, assert } from './helpers/context.mjs'
import { createFeatures } from '../src/extend/hooks/features/features.mjs'

const features = createFeatures({}, null, null)

describe('features — createFeatures', () => {
  it('returns object with execute/list', () => {
    assert.equal(typeof features.execute, 'function')
    assert.equal(typeof features.list, 'function')
  })

  it('list returns known features', () => {
    const list = features.list()
    assert.ok(Array.isArray(list))
    assert.ok(list.includes('lint'), `missing 'lint' in ${list}`)
    assert.ok(list.includes('doc-size-checker'), `missing 'doc-size-checker' in ${list}`)
  })

  it('execute unknown → null', () => {
    const result = features.execute({ name: 'nonexistent', event: {}, featureConfig: {} })
    assert.equal(result, null)
  })
})
