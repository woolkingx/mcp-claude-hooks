#!/usr/bin/env node
// tests/test-schema-chain.mjs — Validate $ref chain integrity + ObjectTree defaults
// config.json → runtime.schema.json → transport.schema.json → mcp-schema.json → tools.json

import { describe, it, assert, HOOKS_SCHEMA_DIR } from './helpers/context.mjs'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Loader, ObjectTree } from '../src/lib/schema2object.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_DIR = resolve(__dirname, '..', 'src', 'project', 'config')

// --- Load all schemas ---
const schemas = {}
for (const name of ['config.json', 'runtime.schema.json', 'transport.schema.json', 'mcp-schema.json', 'tools.json', 'rules.schema.json']) {
  const path = join(CONFIG_DIR, name)
  if (existsSync(path)) {
    schemas[name] = JSON.parse(readFileSync(path, 'utf-8'))
  }
}

describe('schema-chain — $ref resolution + defaults', () => {
  it('all config schemas loadable', () => {
    for (const name of ['config.json', 'runtime.schema.json', 'transport.schema.json', 'mcp-schema.json', 'tools.json']) {
      assert.ok(schemas[name], `${name} not found`)
    }
  })

  it('config.json $ref targets exist', () => {
    const refs = ['mcp-schema.json', 'transport.schema.json', 'runtime.schema.json', 'tools.json']
    for (const ref of refs) {
      assert.ok(schemas[ref], `$ref target ${ref} missing`)
    }
  })

  it('runtime.schema.json Loader resolves all definitions', () => {
    const rt = schemas['runtime.schema.json']
    const loader = new Loader(rt, CONFIG_DIR)
    const defs = rt.definitions
    for (const name of Object.keys(defs)) {
      assert.ok(defs[name], `definition ${name} is empty`)
    }
  })

  it('runtime ObjectTree defaults populate', () => {
    const rt = schemas['runtime.schema.json']
    const loader = new Loader(rt, CONFIG_DIR)
    const tree = new ObjectTree({}, rt, loader).$withDefaults()
    assert.strictEqual(tree.protocolVersion, '2025-03-26')
    assert.strictEqual(tree.server.name, 'mcp-claude-hooks')
    assert.strictEqual(tree.log.level, 'debug')
    assert.ok(tree.errorCodes.PARSE_ERROR)
    assert.ok(tree.lifecycle.drainMs)
  })

  it('runtime ProcessConfig defaults', () => {
    const rt = schemas['runtime.schema.json']
    const loader = new Loader(rt, CONFIG_DIR)
    const tree = new ObjectTree({}, rt, loader).$withDefaults()
    assert.strictEqual(tree.process.mode, 'foreground')
    assert.strictEqual(tree.process.pidFile, 'run/hook.pid')
    assert.strictEqual(tree.process.socketPath, 'run/hook.sock')
  })

  it('runtime overrides merge correctly', () => {
    const rt = schemas['runtime.schema.json']
    const loader = new Loader(rt, CONFIG_DIR)
    const tree = new ObjectTree({ log: { level: 'debug' } }, rt, loader).$withDefaults()
    assert.strictEqual(tree.log.level, 'debug')
    assert.strictEqual(tree.server.name, 'mcp-claude-hooks')
  })

  it('OutputFormat cross-file $ref resolves', () => {
    const rt = schemas['runtime.schema.json']
    const loader = new Loader(rt, CONFIG_DIR)
    const tree = new ObjectTree({}, rt, loader).$withDefaults()
    assert.strictEqual(tree.output.format, 'md')
  })

  it('transport.schema.json defaults populate', () => {
    const ts = schemas['transport.schema.json']
    const loader = new Loader(ts, CONFIG_DIR)
    const tree = new ObjectTree({}, ts, loader).$withDefaults()
    assert.strictEqual(tree.type, 'stdio')
    assert.ok(tree.port)
  })

  it('tools.json has tool categories', () => {
    const tools = schemas['tools.json']
    assert.ok(tools.tools, 'missing tools array')
    assert.ok(tools.tools.length >= 2, 'expected at least 2 tool categories')
    for (const cat of tools.tools) {
      assert.ok(cat.name, 'tool category missing name')
      assert.ok(cat.actions?.length, `${cat.name} has no actions`)
    }
  })

  it('mcp-schema.json has MCP method definitions', () => {
    const mcp = schemas['mcp-schema.json']
    assert.ok(mcp.definitions, 'missing definitions')
    assert.ok(mcp.definitions.InitializeRequest || mcp.definitions.initialize, 'missing initialize definition')
  })
})

describe('schema-chain — hook event schemas', () => {
  const hooksDir = HOOKS_SCHEMA_DIR
  const eventFiles = existsSync(hooksDir)
    ? readdirSync(hooksDir).filter(f => f.endsWith('.json') && f !== 'base.schema.json').sort()
    : []

  it(`${eventFiles.length} event schemas found`, () => {
    assert.ok(eventFiles.length >= 15, `expected >= 15 event schemas, got ${eventFiles.length}`)
  })

  for (const file of eventFiles) {
    const name = file.replace('.json', '')
    it(`event schema: ${name}`, () => {
      const schema = JSON.parse(readFileSync(join(hooksDir, file), 'utf-8'))
      assert.ok(schema.definitions, `${name} missing definitions`)
      assert.ok(schema.definitions.event, `${name} missing event definition`)
      assert.ok(schema.definitions.response, `${name} missing response definition`)
      const hsoKey = `${name}HookSpecificOutput`
      if (schema.definitions[hsoKey]) {
        assert.ok(schema.definitions[hsoKey].properties, `${hsoKey} missing properties`)
      }
    })
  }
})
