// tests/helpers/schema-assert.mjs — Schema-driven assertions
// ObjectTree IS the validator: new ObjectTree(data, schema) throws on mismatch.
// Replace hand-written field checks with schema contract validation.

import { ObjectTree, Loader } from '../../src/lib/schema2object.mjs'
import { strict as assert } from 'node:assert'
import { CONFIG_DIR } from './context.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Root Loader — shared, resolves all $ref chains
const configSchema = JSON.parse(readFileSync(join(CONFIG_DIR, 'config.json'), 'utf-8'))
const rootLoader = new Loader(configSchema, CONFIG_DIR)

// Cache resolved event schemas to avoid re-resolving per test
const _cache = new Map()

function _getEventSchemas(eventName) {
  if (_cache.has(eventName)) return _cache.get(eventName)
  const ref = `hooks/${eventName}.json`
  const resolved = rootLoader.resolve(ref)
  const node = resolved.node || resolved
  const loader = resolved.loader || rootLoader
  const eventDef = node.definitions?.event
  const responseDef = node.definitions?.response
  if (!eventDef) throw new Error(`No event definition for ${eventName}`)
  if (!responseDef) throw new Error(`No response definition for ${eventName}`)
  const entry = { eventDef, responseDef, loader }
  _cache.set(eventName, entry)
  return entry
}

// --- Event input validation ---

export function assertValidEvent(eventName, data) {
  const { eventDef, loader } = _getEventSchemas(eventName)
  try {
    new ObjectTree(data, eventDef, loader)
  } catch (e) {
    assert.fail(`Event input fails ${eventName} schema: ${e.message}\nData: ${JSON.stringify(data, null, 2)}`)
  }
}

// --- Response output validation ---

export function assertValidResponse(eventName, data) {
  const { responseDef, loader } = _getEventSchemas(eventName)
  try {
    new ObjectTree(data, responseDef, loader)
  } catch (e) {
    assert.fail(`Response fails ${eventName} schema: ${e.message}\nData: ${JSON.stringify(data, null, 2)}`)
  }
}

// --- Composite assertions: schema validation + behavior check ---

export function assertSchemaDeny(eventName, resp) {
  assertValidResponse(eventName, resp)
  assert.equal(resp.continue, false, 'deny → continue must be false')
}

export function assertSchemaAllow(eventName, resp) {
  assertValidResponse(eventName, resp)
  assert.equal(resp.continue, true, 'allow → continue must be true')
}

export function assertSchemaAsk(eventName, resp) {
  assertValidResponse(eventName, resp)
  assert.equal(resp.continue, true, 'ask → continue must be true')
  assert.equal(resp.hookSpecificOutput?.permissionDecision, 'ask',
    'ask → permissionDecision must be "ask"')
}

export function assertSchemaContext(eventName, resp) {
  assertValidResponse(eventName, resp)
  assert.equal(resp.continue, true, 'context → continue must be true')
  assert.ok(resp.hookSpecificOutput?.additionalContext || resp.systemMessage,
    'context → must have additionalContext or systemMessage')
}

// --- Helpers for building schema-valid event inputs ---

export function buildMinimalEvent(eventName, overrides = {}) {
  const { eventDef } = _getEventSchemas(eventName)
  const data = {}
  const required = eventDef.required || []
  const props = eventDef.properties || {}

  for (const key of required) {
    const prop = props[key]
    if (!prop) continue
    if (prop.const) data[key] = prop.const
    else if (prop.enum) data[key] = prop.enum[0]
    else if (prop.type === 'string') data[key] = `test-${key}`
    else if (prop.type === 'boolean') data[key] = false
    else if (prop.type === 'object') data[key] = {}
    else if (prop.type === 'array') data[key] = []
    else data[key] = `test-${key}`
  }

  return { ...data, ...overrides }
}

// Export root loader + resolver for advanced use
export { rootLoader, _getEventSchemas }
