#!/usr/bin/env node
// tests/test-hook.mjs — Integration tests for hook processor

import { describe, it, assert, ROOT } from './helpers/context.mjs'
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function hook(event) {
  const input = JSON.stringify(event)
  try {
    const out = execSync(`echo '${input.replace(/'/g, "'\\''")}' | node src/main.mjs`, {
      encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe']
    })
    return out.trim() ? JSON.parse(out.trim()) : null
  } catch (e) {
    const out = e.stdout?.trim()
    return out ? JSON.parse(out) : null
  }
}

// Print rule summary for diagnostics
{
  const rulesDir = join(ROOT, 'rules')
  const files = readdirSync(rulesDir).filter(f => f.endsWith('.json'))
  const rules = files.map(f => {
    try { return JSON.parse(readFileSync(join(rulesDir, f), 'utf8')) }
    catch { return null }
  }).filter(Boolean)

  const enabled  = rules.filter(r => r.enabled === true)
  const disabled = rules.filter(r => r.enabled === false)
  const testMode = rules.filter(r => r.enabled === 'test')

  console.log(`[enabled: ${enabled.length}, disabled: ${disabled.length}, test: ${testMode.length}]`)
}

describe('hook — PreToolUse deny rules', () => {
  it('rm → deny', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm foo' } })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('rm -rf → deny (dangerous)', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp' } })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('sudo → deny', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'sudo apt update' } })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('sed → deny', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'sed -i s/a/b/ file' } })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('cat → deny', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cat /etc/passwd' } })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('find → deny', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'find . -name *.py' } })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('Bash grep → pass (grep-use-rg disabled)', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'grep -r TODO src/' } })
    assert.equal(r, null)
  })

  it('WebSearch → deny', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'WebSearch', tool_input: { query: 'test' } })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('git checkout branch → ask', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git checkout main' } })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'ask')
  })

  it('git force push main → deny', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('git reset --hard → deny', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git reset --hard HEAD' } })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('git clean → deny', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git clean -fd' } })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('echo > file → deny', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo hello > test.txt' } })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
  })
})

describe('hook — PreToolUse allow rules', () => {
  it('Read .md → allow', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/docs/README.md' } })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'allow')
  })

  it('ls -la → pass (no rule)', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls -la' } })
    assert.equal(r, null)
  })

  it('git status → pass (read-only excluded)', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } })
    assert.equal(r, null)
  })
})

describe('hook — PreToolUse ask rules', () => {
  it('git commit → ask', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "test"' } })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'ask')
  })

  it('Write .md → pass (ask-md-creation disabled)', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/home/user/new.md' } })
    assert.equal(r, null)
  })

  it('Edit .env → pass (ask-config-modify disabled)', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/home/user/.env' } })
    assert.equal(r, null)
  })
})

describe('hook — other events', () => {
  it('SessionStart → welcome (HSO)', () => {
    const r = hook({ hook_event_name: 'SessionStart' })
    assert.ok(r.hookSpecificOutput?.additionalContext)
  })

  it('SubagentStart → context (HSO)', () => {
    const r = hook({ hook_event_name: 'SubagentStart' })
    assert.ok(r.hookSpecificOutput?.additionalContext)
  })

  it('PostCompact → context reload', () => {
    const r = hook({ hook_event_name: 'PostCompact' })
    assert.ok(r.systemMessage)
  })

  it('PermissionRequest Read .json → pass (disabled)', () => {
    const r = hook({ hook_event_name: 'PermissionRequest', tool_name: 'Read', tool_input: { file_path: 'config.json' } })
    assert.equal(r, null)
  })
})

describe('hook — cwd filtering', () => {
  it('cwd filter skips non-matching project', () => {
    const r = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: '/other/project', tool_input: { command: 'rm foo' } })
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
  })

  it('unknown event → no match', () => {
    const r = hook({ hook_event_name: 'UnknownEvent' })
    assert.equal(r, null)
  })
})
