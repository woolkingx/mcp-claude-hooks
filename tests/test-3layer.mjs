#!/usr/bin/env node
// tests/test-3layer.mjs — Verify L1/L2/L3 progressive disclosure and schema-driven values

import { describe, it, assert, ROOT } from './helpers/context.mjs'
import { join } from 'node:path'
import { loadSchemas } from '../src/foundation/schemas.mjs'
import { createBus } from '../src/foundation/bus.mjs'
import { createDispatch } from '../src/server/dispatch.mjs'

const CONFIG_DIR = join(ROOT, 'src', 'project', 'config')
const { schemas, loaders } = loadSchemas(CONFIG_DIR)

// --- Setup dispatch ---
const bus = createBus()
const mockHandlers = {
  hooks_rules: {
    list: (input) => ({ action: 'list', received: input.$toDict() }),
    create: (input) => ({ action: 'create', received: input.$toDict() })
  },
  hooks_admin: { status: () => ({ server: 'ok' }) }
}
const ctx = { output: { format: 'json' } }
const { getToolList } = createDispatch(bus, schemas.tools, loaders.tools, mockHandlers, ctx)
const tools = getToolList()

describe('3-layer — L1: tool list', () => {
  it('returns tool list', () => {
    assert.ok(Array.isArray(tools))
    assert.ok(tools.length >= 2)
  })

  it('has only action + format props (no merged action params)', () => {
    for (const tool of tools) {
      const propKeys = Object.keys(tool.inputSchema.properties)
      assert.deepStrictEqual(propKeys, ['action', 'format'],
        `${tool.name}: expected [action, format], got [${propKeys}]`)
    }
  })

  it('action enum matches tools.json actions', () => {
    for (const tool of tools) {
      const cat = schemas.tools.tools.find(t => t.name === tool.name)
      const expected = cat.actions.map(a => a.name)
      assert.deepStrictEqual(tool.inputSchema.properties.action.enum, expected)
    }
  })

  it('format enum comes from schema (not hardcoded)', () => {
    for (const tool of tools) {
      const fmt = tool.inputSchema.properties.format
      assert.ok(fmt.enum, `${tool.name}: format should have enum`)
      assert.ok(fmt.enum.includes('md'), `${tool.name}: format enum should include md`)
      assert.ok(fmt.enum.includes('json'), `${tool.name}: format enum should include json`)
    }
  })

  it('description includes action summaries', () => {
    for (const tool of tools) {
      const cat = schemas.tools.tools.find(t => t.name === tool.name)
      for (const action of cat.actions) {
        assert.ok(tool.description.includes(action.name),
          `${tool.name} description missing action ${action.name}`)
      }
    }
  })

  it('allows additional properties for L2/L3 passthrough', () => {
    for (const tool of tools) {
      assert.strictEqual(tool.inputSchema.additionalProperties, true)
    }
  })
})

describe('3-layer — L2: action help on validation error', () => {
  it('no action → returns action list', async () => {
    const result = await bus.send('dispatch', { name: 'hooks_rules', arguments: {} })
    assert.strictEqual(result.status, 200)
    const data = typeof result.data === 'string' ? JSON.parse(result.data) : result.data
    assert.ok(Array.isArray(data))
    assert.ok(data.some(a => a.name === 'list'))
    assert.ok(data.some(a => a.name === 'create'))
  })

  it('invalid input → returns schema help (not error)', async () => {
    const result = await bus.send('dispatch', {
      name: 'hooks_rules',
      arguments: { action: 'create', name: 'test-rule' }
    })
    assert.strictEqual(result.status, 200)
    const data = typeof result.data === 'string' ? JSON.parse(result.data) : result.data
    assert.ok(data.error)
    assert.ok(data.inputSchema)
    assert.ok(data.inputSchema.properties)
    assert.strictEqual(data.action, 'create')
    assert.ok(Array.isArray(data.args))
    assert.ok(data.args.length > 0)
    assert.ok(data.args.some(a => a.name === 'name'))
    assert.ok(data.example)
    assert.strictEqual(data.example.action, 'create')
  })
})

describe('3-layer — L3: execution', () => {
  it('valid input → executes handler', async () => {
    const result = await bus.send('dispatch', {
      name: 'hooks_rules',
      arguments: { action: 'list' }
    })
    assert.strictEqual(result.status, 200)
    const data = typeof result.data === 'string' ? JSON.parse(result.data) : result.data
    assert.strictEqual(data.action, 'list')
  })
})

describe('3-layer — schema-driven values', () => {
  it('Action enum from rules.schema.json', () => {
    const actionDef = schemas.rules.definitions?.Action
    assert.ok(actionDef?.enum)
    assert.ok(actionDef.enum.includes('deny'))
    assert.ok(actionDef.enum.includes('allow'))
    assert.ok(actionDef.enum.includes('context'))
  })

  it('HookEvent enum from rules.schema.json', () => {
    const eventDef = schemas.rules.definitions?.HookEvent
    assert.ok(eventDef?.enum)
    assert.ok(eventDef.enum.includes('PreToolUse'))
    assert.ok(eventDef.enum.includes('StopFailure'))
    assert.ok(eventDef.enum.length >= 22)
  })

  it('UnbashCommand fields from rules.schema.json', () => {
    const unbash = schemas.rules.definitions?.UnbashCommand
    assert.ok(unbash?.properties)
    assert.ok(unbash.properties.name)
    assert.ok(unbash.properties.suffix)
    assert.ok(unbash.properties.redirects)
    assert.ok(unbash['x-match-patterns'])
  })

  it('runtime.schema.json x-readonly annotations', () => {
    const props = schemas.runtime.properties
    assert.ok(props.transport['x-readonly'])
    assert.ok(props.process['x-readonly'])
    assert.ok(!props.log['x-readonly'])
    assert.ok(!props.output['x-readonly'])
  })

  it('runtime.schema.json x-internal annotations', () => {
    const props = schemas.runtime.properties
    assert.ok(props.protocolVersion['x-internal'])
    assert.ok(props.errorCodes['x-internal'])
    assert.ok(!props.server['x-internal'])
  })

  it('ConfigInput section enum matches runtime schema properties', () => {
    const configInput = schemas.tools.definitions?.ConfigInput
    const sectionEnum = configInput?.properties?.section?.enum
    assert.ok(sectionEnum)
    const rtProps = Object.keys(schemas.runtime.properties)
    for (const s of sectionEnum) {
      if (s === 'all') continue
      assert.ok(rtProps.includes(s), `section "${s}" not in runtime schema properties`)
    }
  })
})
