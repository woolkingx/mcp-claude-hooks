// hook.mjs — Root extend module
// Boot order: rules → features → state → engine
// All internal modules use fn calls, NOT bus
// setup(bus, config) → teardown

import { createRules } from './rules/rules.mjs'
import { createFeatures } from './features/features.mjs'
import { createEngine } from './engine/engine.mjs'
import { createState } from './engine/state.mjs'
import { Loader } from '../../lib/schema2object.mjs'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function setup(bus, config) {
  // Build root Loader from config.schema.json
  let loader
  try {
    const configSchemaPath = resolve(__dirname, '..', '..', 'project', 'config', 'config.json')
    const configSchema = JSON.parse(readFileSync(configSchemaPath, 'utf-8'))
    loader = new Loader(configSchema, dirname(configSchemaPath))
  } catch (e) {
    // Fallback if config schema not found
    loader = null
  }

  // Create object modules (no bus dependency)
  const rules = createRules(config, loader)
  const features = createFeatures(config, bus, loader)
  const state = createState({ projectRoot: config.projectRoot, bus }, loader)
  const engine = createEngine({ rules, features, state, config, projectRoot: config.projectRoot, bus, loader })

  // Register engine on bus
  bus.handle('hooks:process-event', (event) => engine.processEvent(event))

  // Teardown
  function _teardown() {
    bus.unhandle('hooks:process-event')
  }

  return { teardown: _teardown, loader }
}
