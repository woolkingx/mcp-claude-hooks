#!/usr/bin/env node
// tests/test-adapters.mjs — Test all adapter interfaces against the one backend.

import { describe, it, assert, ROOT } from './helpers/context.mjs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

const MAIN = join(ROOT, 'src', 'main.mjs')

function run(cmd, input) {
  try {
    return execSync(cmd, { input, encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    return (e.stdout || '').trim()
  }
}

function runAll(cmd, input) {
  try {
    const result = execSync(cmd, { input, encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] })
    return { stdout: result.trim(), stderr: '' }
  } catch (e) {
    return { stdout: (e.stdout || '').trim(), stderr: (e.stderr || '').trim() }
  }
}

describe('adapter — hook via main.mjs (stdin piped)', () => {
  it('deny rm', () => {
    const out = run(`node ${MAIN}`, JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }))
    const r = JSON.parse(out)
    assert.equal(r.continue, false)
  })

  it('pass ls', () => {
    const { stdout } = runAll(`node ${MAIN}`, JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }))
    assert.ok(!stdout || stdout === '', `expected empty stdout, got: ${stdout}`)
  })

  it('deny sudo', () => {
    const out = run(`node ${MAIN}`, JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'sudo apt install foo' } }))
    const r = JSON.parse(out)
    assert.equal(r.continue, false)
  })

  it('ask git commit', () => {
    const out = run(`node ${MAIN}`, JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "test"' } }))
    const r = JSON.parse(out)
    assert.equal(r.hookSpecificOutput?.permissionDecision, 'ask')
  })

  it('SessionStart HSO', () => {
    const out = run(`node ${MAIN}`, JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'test' }))
    const r = JSON.parse(out)
    assert.ok(r.hookSpecificOutput?.additionalContext)
  })
})

describe('adapter — CLI via main.mjs', () => {
  it('cli list categories', () => {
    const out = run(`node ${MAIN} cli`)
    assert.ok(out.includes('hooks_admin'))
    assert.ok(out.includes('hooks_rules'))
  })

  it('cli hooks_admin status', () => {
    const out = run(`node ${MAIN} cli hooks_admin status`)
    assert.ok(out.includes('mcp-claude-hooks'))
    assert.ok(out.includes('rules_active'))
  })

  it('cli hooks_rules list', () => {
    const out = run(`node ${MAIN} cli hooks_rules list`)
    assert.ok(out.includes('deny-rm') || out.includes('deny_rm'))
  })

  it('cli hooks_admin check', () => {
    const out = run(`node ${MAIN} cli hooks_admin check`)
    assert.ok(out.includes('pass') || out.includes('ok'))
  })
})

describe('adapter — daemon commands (no boot)', () => {
  it('status when not running', () => {
    const out = run(`node ${MAIN} status`)
    const r = JSON.parse(out)
    assert.ok(r.running === false || r.running === true)
  })

  it('reload when not running', () => {
    const out = run(`node ${MAIN} reload`)
    const r = JSON.parse(out)
    assert.ok(r.reloaded !== undefined)
  })
})
