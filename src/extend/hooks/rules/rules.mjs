// rules/rules.mjs — Rule index object module
// Returns ObjectTree: { get(eventName), reload() }
// NO BUS DEPENDENCY — internal fn call only

import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ObjectTree } from '../../../lib/schema2object.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..')

export function createRules(config = {}, loader) {
  let rulesDir = resolve(PROJECT_ROOT, 'rules')
  let rulesCache = null

  function _loadAll() {
    rulesCache = new Map()
    if (!existsSync(rulesDir)) return
    const realRulesDir = realpathSync(rulesDir)
    for (const file of readdirSync(rulesDir).filter(f => f.endsWith('.json')).sort()) {
      try {
        const filePath = join(rulesDir, file)
        const realPath = realpathSync(filePath)
        if (!realPath.startsWith(realRulesDir)) continue // symlink escape
        const raw = JSON.parse(readFileSync(realPath, 'utf-8'))
        rulesCache.set(raw.name, raw)
      } catch (e) {
        // Silently skip invalid rules
      }
    }
  }

  function _init() {
    if (rulesCache === null) _loadAll()
  }

  let rulesSchema
  try { rulesSchema = loader?.resolve('../../extend/hooks/rules/rules.schema.json')?.node } catch {}

  const tree = new ObjectTree({}, rulesSchema || { type: 'object' }, loader)

  tree.get = function(eventName) {
    _init()
    return [...rulesCache.values()]
      .filter(r => r.enabled !== false && r.event === eventName)
      .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))
  }

  tree.reload = function() {
    rulesCache = null
    _init()
  }

  return tree
}
