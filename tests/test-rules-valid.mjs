#!/usr/bin/env node
// tests/test-rules-valid.mjs — Validate all rules/*.json against rules.schema.json

import { describe, it, assert, ROOT } from './helpers/context.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ObjectTree, Loader } from '../src/lib/schema2object.mjs'
import { generateTemplate, listEvents } from '../src/project/handlers/template.mjs'

const RULES_DIR = join(ROOT, 'rules')
const SCHEMA_PATH = join(ROOT, 'src', 'project', 'config', 'rules.schema.json')

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'))
const loader = new Loader(schema, join(ROOT, 'src', 'project', 'config'))
const ruleDef = schema.definitions.Rule

const files = readdirSync(RULES_DIR).filter(f => f.endsWith('.json')).sort()

// Pre-build template cache per event
const eventTemplates = new Map()
for (const ev of listEvents()) {
  eventTemplates.set(ev, generateTemplate(ev, { ruleSchema: schema }))
}

const FIELD_ORDER = ['name', 'description', 'enabled', 'event', 'priority', 'tool', 'cwd', 'action', 'reason', 'match', 'match_bash', 'feature', 'transform', 'updatedInput', 'loaders', 'tags', 'agent', 'repeat']

describe('rules-valid — per-rule schema validation', () => {
  for (const file of files) {
    const name = file.replace('.json', '')
    it(name, () => {
      const raw = JSON.parse(readFileSync(join(RULES_DIR, file), 'utf-8'))
      assert.ok(raw.name, 'missing name')
      assert.ok(raw.event, 'missing event')
      assert.ok(raw.action, 'missing action')
      const tree = new ObjectTree(raw, ruleDef, loader)
      const result = tree.$toDict()
      assert.strictEqual(result.name, raw.name)
      assert.strictEqual(result.event, raw.event)
    })
  }
})

describe('rules-valid — naming + required fields', () => {
  it('name matches filename', () => {
    for (const file of files) {
      const raw = JSON.parse(readFileSync(join(RULES_DIR, file), 'utf-8'))
      const expected = file.replace('.json', '')
      assert.strictEqual(raw.name, expected, `${file}: name "${raw.name}" !== filename "${expected}"`)
    }
  })

  it('all rules have description and priority', () => {
    const missing = []
    for (const file of files) {
      const raw = JSON.parse(readFileSync(join(RULES_DIR, file), 'utf-8'))
      if (!raw.description) missing.push(`${file}: missing description`)
      if (raw.priority === undefined) missing.push(`${file}: missing priority`)
    }
    if (missing.length) throw new Error(missing.join('; '))
  })
})

describe('rules-valid — field order + structure', () => {
  it('field order follows convention', () => {
    const bad = []
    for (const file of files) {
      const raw = JSON.parse(readFileSync(join(RULES_DIR, file), 'utf-8'))
      const keys = Object.keys(raw)
      const indices = keys.map(k => FIELD_ORDER.indexOf(k)).filter(i => i >= 0)
      const sorted = [...indices].sort((a, b) => a - b)
      if (JSON.stringify(indices) !== JSON.stringify(sorted)) {
        bad.push(`${file}: got [${keys.join(',')}]`)
      }
    }
    if (bad.length) throw new Error(`${bad.length} files with wrong order:\n  ${bad.join('\n  ')}`)
  })

  it('match has no redundant type:"object"', () => {
    const bad = []
    for (const file of files) {
      const raw = JSON.parse(readFileSync(join(RULES_DIR, file), 'utf-8'))
      if (raw.match?.type === 'object') bad.push(file)
      if (raw.match_bash?.type === 'object') bad.push(`${file} (match_bash)`)
    }
    if (bad.length) throw new Error(`redundant type:"object" in: ${bad.join(', ')}`)
  })
})

describe('rules-valid — template-based validation', () => {
  it('match fields valid for event', () => {
    const bad = []
    for (const file of files) {
      const raw = JSON.parse(readFileSync(join(RULES_DIR, file), 'utf-8'))
      if (!raw.match?.properties) continue
      const tmpl = eventTemplates.get(raw.event)
      if (!tmpl || tmpl.error) continue
      const validFields = new Set(Object.keys(tmpl.fields))
      for (const key of Object.keys(raw.match.properties)) {
        if (!validFields.has(key)) bad.push(`${file}: match field "${key}" not in ${raw.event} schema`)
      }
    }
    if (bad.length) throw new Error(bad.join('; '))
  })

  it('match_bash only on tool events', () => {
    const bad = []
    for (const file of files) {
      const raw = JSON.parse(readFileSync(join(RULES_DIR, file), 'utf-8'))
      if (!raw.match_bash) continue
      const tmpl = eventTemplates.get(raw.event)
      if (!tmpl) continue
      if (!tmpl.rule_skeleton.match_bash) {
        bad.push(`${file}: match_bash on non-tool event ${raw.event}`)
      }
    }
    if (bad.length) throw new Error(bad.join('; '))
  })

  it('action valid for event', () => {
    const bad = []
    for (const file of files) {
      const raw = JSON.parse(readFileSync(join(RULES_DIR, file), 'utf-8'))
      const tmpl = eventTemplates.get(raw.event)
      if (!tmpl || tmpl.error) continue
      if (!tmpl.actions.includes(raw.action)) {
        bad.push(`${file}: action "${raw.action}" not in ${raw.event} actions`)
      }
    }
    if (bad.length) throw new Error(bad.join('; '))
  })
})
