#!/usr/bin/env node
// tests/test-template.mjs — Verify rule template generator

import { describe, it, assert, ROOT } from './helpers/context.mjs'
import { generateTemplate, listEvents } from '../src/project/handlers/template.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ruleSchemaPath = join(ROOT, 'src', 'project', 'config', 'rules.schema.json')
const ruleSchema = JSON.parse(readFileSync(ruleSchemaPath, 'utf-8'))

describe('template — listEvents', () => {
  it('returns all event names', () => {
    const events = listEvents()
    assert.ok(Array.isArray(events))
    assert.ok(events.includes('PreToolUse'))
    assert.ok(events.includes('UserPromptSubmit'))
    assert.ok(events.includes('SessionStart'))
    assert.ok(!events.includes('base.schema'))
  })
})

describe('template — list + error modes', () => {
  it('no event → list mode', () => {
    const result = generateTemplate(null)
    assert.ok(result.events)
    assert.ok(result.count)
    assert.ok(result.usage)
  })

  it('invalid event → error with available list', () => {
    const result = generateTemplate('NonExistent')
    assert.ok(result.error)
    assert.ok(result.available)
  })
})

describe('template — PreToolUse skeleton', () => {
  it('has full skeleton with meta fields', () => {
    const result = generateTemplate('PreToolUse', { ruleSchema })
    assert.ok(!result.error)
    assert.equal(result.event, 'PreToolUse')
    const sk = result.rule_skeleton
    assert.ok(sk)
    for (const f of ['name', 'description', 'event', 'enabled', 'priority', 'repeat', 'action', 'reason']) {
      assert.ok(sk[f] !== undefined, `skeleton missing: ${f}`)
    }
  })

  it('match has all event fields', () => {
    const result = generateTemplate('PreToolUse', { ruleSchema })
    const match = result.rule_skeleton.match
    assert.ok(match?.properties)
    const expected = ['session_id', 'cwd', 'tool_name', 'tool_input', 'tool_use_id', 'permission_mode', 'transcript_path']
    for (const f of expected) {
      assert.ok(match.properties[f], `match missing field: ${f}`)
    }
    assert.ok(!match.properties.hook_event_name)
  })

  it('has match_bash', () => {
    const result = generateTemplate('PreToolUse', { ruleSchema })
    const bash = result.rule_skeleton.match_bash
    assert.ok(bash)
    assert.ok(bash.properties?.name)
    assert.ok(bash.properties?.suffix)
    assert.ok(bash.properties?.redirects)
    assert.ok(bash.required?.includes('name'))
  })

  it('has response with HSO', () => {
    const result = generateTemplate('PreToolUse', { ruleSchema })
    const resp = result.rule_skeleton.response
    assert.ok(resp)
    assert.ok(resp.decision !== undefined)
    assert.ok(resp.reason !== undefined)
    const hso = resp.hookSpecificOutput
    assert.ok(hso)
    assert.equal(hso.hookEventName, 'PreToolUse')
    assert.ok(hso.additionalContext !== undefined)
  })

  it('has feature, loaders, agent, tags', () => {
    const result = generateTemplate('PreToolUse', { ruleSchema })
    const sk = result.rule_skeleton
    assert.ok(sk.feature)
    assert.ok(sk.feature.name)
    assert.ok(sk.loaders)
    assert.ok(sk.agent)
    assert.ok(sk.tags)
  })

  it('has tool shorthand', () => {
    const result = generateTemplate('PreToolUse', { ruleSchema })
    assert.ok(result.rule_skeleton.tool)
  })

  it('has fields reference with types', () => {
    const result = generateTemplate('PreToolUse', { ruleSchema })
    assert.ok(result.fields)
    assert.ok(result.fields.tool_name)
    assert.equal(result.fields.tool_name.type, 'string')
    assert.ok(result.fields.cwd.required)
  })

  it('has actions list', () => {
    const result = generateTemplate('PreToolUse', { ruleSchema })
    assert.ok(result.actions)
    assert.ok(result.actions.includes('deny'))
    assert.ok(result.actions.includes('allow'))
  })
})

describe('template — non-tool events', () => {
  it('UserPromptSubmit has prompt field, no match_bash', () => {
    const result = generateTemplate('UserPromptSubmit', { ruleSchema })
    assert.ok(!result.error)
    assert.ok(result.rule_skeleton.match.properties.prompt)
    assert.ok(!result.rule_skeleton.match_bash)
    assert.ok(!result.rule_skeleton.tool)
  })

  it('SessionStart has source and model fields', () => {
    const result = generateTemplate('SessionStart', { ruleSchema })
    assert.ok(!result.error)
    assert.ok(result.rule_skeleton.match.properties.source)
    assert.ok(result.rule_skeleton.match.properties.model)
    assert.ok(result.fields.source.values?.includes('startup'))
  })

  it('PermissionRequest has permission_suggestions field', () => {
    const result = generateTemplate('PermissionRequest', { ruleSchema })
    assert.ok(!result.error)
    assert.ok(result.fields.permission_suggestions)
  })

  it('PostToolUse has tool_response field', () => {
    const result = generateTemplate('PostToolUse', { ruleSchema })
    assert.ok(!result.error)
    assert.ok(result.fields.tool_response)
  })
})

describe('template — all events', () => {
  it('all events produce valid templates', () => {
    const events = listEvents()
    const failures = []
    for (const ev of events) {
      const result = generateTemplate(ev, { ruleSchema })
      if (result.error) { failures.push(`${ev}: ${result.error}`); continue }
      if (!result.rule_skeleton) failures.push(`${ev}: missing skeleton`)
      if (!result.fields) failures.push(`${ev}: missing fields`)
    }
    if (failures.length) throw new Error(`Failed events:\n  ${failures.join('\n  ')}`)
  })
})
