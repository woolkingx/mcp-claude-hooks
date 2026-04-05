// features/features.mjs — Feature registry object module
// Returns ObjectTree: { execute(ruleFeature, event), list() }
// NO BUS DEPENDENCY — internal fn call only

import * as lint from './lint/lint.mjs'
import * as docSizeChecker from './doc-size-checker/doc-size-checker.mjs'
import { ObjectTree } from '../../../lib/schema2object.mjs'

export function createFeatures(config = {}, bus, loader) {
  const _registry = new Map([lint, docSizeChecker].map(f => [f.name, f.execute]))

  function _log(level, msg) {
    if (!bus) return
    bus.send('log', { ts: Date.now(), level, event: 'feature', message: msg })
      .catch(e => { try { process.stderr.write(`[log-err] feature ${e.message}\n`) } catch {} })
  }

  function _resolveFeature(ruleFeature) {
    if (!ruleFeature) return null
    if (typeof ruleFeature === 'string') return { name: ruleFeature, config: {} }
    return { name: ruleFeature.name, config: ruleFeature.config ?? {} }
  }

  let featuresSchema
  try { featuresSchema = loader?.resolve('../../extend/hooks/features/features.schema.json')?.node } catch {}

  const tree = new ObjectTree({}, featuresSchema || { type: 'object' }, loader)

  tree.execute = function(ruleFeature, event) {
    const feature = _resolveFeature(ruleFeature)
    if (!feature) { _log('debug', `execute: no feature`); return null }

    const execute = _registry.get(feature.name)
    if (execute) {
      const result = execute(event, feature.config)
      _log('debug', `execute: ${feature.name} type=${typeof result}`)
      return result
    }

    _log('debug', `execute: ${feature.name} not found in registry`)
    return null
  }

  tree.list = function() {
    return [..._registry.keys()]
  }

  return tree
}
