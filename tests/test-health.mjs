#!/usr/bin/env node
// tests/test-health.mjs — Health feature: probes, scoring, state, context format

import { describe, it, assert, freshDir, ROOT } from './helpers/context.mjs'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

// --- Probe unit tests ---

describe('health probes — claude_md', () => {
  it('pass when .claude/CLAUDE.md exists', async () => {
    const dir = freshDir()
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'CLAUDE.md'), '# Rules')
    const { check } = await import('../src/extend/hooks/features/health/probes/claude-md.mjs')
    const r = check(dir)
    assert.equal(r.status, 'pass')
    assert.ok(r.detail.includes('CLAUDE.md'))
  })

  it('pass when root CLAUDE.md exists', async () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'CLAUDE.md'), '# Rules')
    const { check } = await import('../src/extend/hooks/features/health/probes/claude-md.mjs')
    const r = check(dir)
    assert.equal(r.status, 'pass')
  })

  it('fail when no CLAUDE.md', async () => {
    const dir = freshDir()
    const { check } = await import('../src/extend/hooks/features/health/probes/claude-md.mjs')
    const r = check(dir)
    assert.equal(r.status, 'fail')
  })
})

describe('health probes — architecture', () => {
  it('pass when architecture.md exists', async () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'architecture.md'), '# Arch')
    const { check } = await import('../src/extend/hooks/features/health/probes/architecture.mjs')
    const r = check(dir)
    assert.equal(r.status, 'pass')
  })

  it('pass when .claude/rules/ has .md files', async () => {
    const dir = freshDir()
    mkdirSync(join(dir, '.claude', 'rules'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'rules', 'api.md'), '# API')
    const { check } = await import('../src/extend/hooks/features/health/probes/architecture.mjs')
    const r = check(dir)
    assert.equal(r.status, 'pass')
    assert.ok(r.detail.includes('.claude/rules/'))
  })

  it('fail when no architecture docs', async () => {
    const dir = freshDir()
    const { check } = await import('../src/extend/hooks/features/health/probes/architecture.mjs')
    const r = check(dir)
    assert.equal(r.status, 'fail')
  })
})

describe('health probes — tests', () => {
  it('pass when tests/ exists', async () => {
    const dir = freshDir()
    mkdirSync(join(dir, 'tests'))
    const { check } = await import('../src/extend/hooks/features/health/probes/tests.mjs')
    const r = check(dir)
    assert.equal(r.status, 'pass')
  })

  it('fail when no test dir', async () => {
    const dir = freshDir()
    const { check } = await import('../src/extend/hooks/features/health/probes/tests.mjs')
    const r = check(dir)
    assert.equal(r.status, 'fail')
  })
})

describe('health probes — manifest', () => {
  it('pass when package.json exists', async () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'package.json'), '{}')
    const { check } = await import('../src/extend/hooks/features/health/probes/manifest.mjs')
    const r = check(dir)
    assert.equal(r.status, 'pass')
    assert.ok(r.detail.includes('package.json'))
  })

  it('pass when Cargo.toml exists', async () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'Cargo.toml'), '[package]')
    const { check } = await import('../src/extend/hooks/features/health/probes/manifest.mjs')
    const r = check(dir)
    assert.equal(r.status, 'pass')
  })
})

describe('health probes — readme', () => {
  it('pass when README.md exists', async () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'README.md'), '# Project')
    const { check } = await import('../src/extend/hooks/features/health/probes/readme.mjs')
    const r = check(dir)
    assert.equal(r.status, 'pass')
  })
})

describe('health probes — license', () => {
  it('pass when LICENSE exists', async () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'LICENSE'), 'MIT')
    const { check } = await import('../src/extend/hooks/features/health/probes/license.mjs')
    const r = check(dir)
    assert.equal(r.status, 'pass')
  })
})

describe('health probes — git_active', () => {
  it('pass when recent commit exists', async () => {
    const dir = freshDir()
    execSync('git init && git add -A && git commit --allow-empty -m init', { cwd: dir, stdio: 'pipe' })
    const { check } = await import('../src/extend/hooks/features/health/probes/git-state.mjs')
    const r = check(dir)
    assert.equal(r.status, 'pass')
    assert.ok(r.detail.includes('0d ago'))
  })

  it('fail when no git repo', async () => {
    const dir = freshDir()
    const { check } = await import('../src/extend/hooks/features/health/probes/git-state.mjs')
    const r = check(dir)
    assert.equal(r.status, 'fail')
    assert.ok(r.detail.includes('Not a git'))
  })
})

describe('health probes — hooks_coverage', () => {
  it('fail when no rules dir', async () => {
    const dir = freshDir()
    const { check } = await import('../src/extend/hooks/features/health/probes/hooks-coverage.mjs')
    const r = check(dir, { _rulesDir: join(dir, 'nonexistent') })
    assert.equal(r.status, 'fail')
  })

  it('pass when rules target cwd', async () => {
    const dir = freshDir()
    const rulesDir = join(dir, 'rules')
    mkdirSync(rulesDir)
    writeFileSync(join(rulesDir, 'test-rule.json'), JSON.stringify({
      name: 'test-rule', event: 'PreToolUse', action: 'deny', cwd: dir
    }))
    const { check } = await import('../src/extend/hooks/features/health/probes/hooks-coverage.mjs')
    const r = check(dir, { _rulesDir: rulesDir })
    assert.equal(r.status, 'pass')
  })
})

describe('health probes — env_protected', () => {
  it('pass when deny rule mentions .env', async () => {
    const dir = freshDir()
    const rulesDir = join(dir, 'rules')
    mkdirSync(rulesDir)
    writeFileSync(join(rulesDir, 'deny-env.json'), JSON.stringify({
      name: 'deny-env', event: 'PreToolUse', action: 'deny', enabled: true,
      match: { properties: { tool_input: { properties: { file_path: { pattern: '\\.env' } } } } }
    }))
    const { check } = await import('../src/extend/hooks/features/health/probes/env-protected.mjs')
    const r = check(dir, { _rulesDir: rulesDir })
    assert.equal(r.status, 'pass')
  })
})

// --- Probe index ---

describe('health probes — runProbes', () => {
  it('runs all probes and returns results', async () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'README.md'), '# Test')
    const { runProbes } = await import('../src/extend/hooks/features/health/probes/index.mjs')
    const results = runProbes(dir, { _rulesDir: join(ROOT, 'rules') })
    assert.ok(results.length >= 9, `expected >= 9 probes, got ${results.length}`)
    for (const r of results) {
      assert.ok(r.name, 'probe must have name')
      assert.ok(r.weight >= 1, 'probe must have weight >= 1')
      assert.ok(['pass', 'fail'].includes(r.status), `invalid status: ${r.status}`)
      assert.ok(r.detail, 'probe must have detail')
    }
  })

  it('respects checks filter', async () => {
    const dir = freshDir()
    const { runProbes } = await import('../src/extend/hooks/features/health/probes/index.mjs')
    const results = runProbes(dir, { checks: ['readme', 'license'] })
    assert.equal(results.length, 2)
    assert.equal(results[0].name, 'readme')
    assert.equal(results[1].name, 'license')
  })
})

// --- Scoring + grading ---

describe('health — scoring', () => {
  it('project root scores high (has CLAUDE.md, tests, README, etc)', async () => {
    const { assess } = await import('../src/extend/hooks/features/health/health.mjs')
    const result = assess(ROOT, { _rulesDir: join(ROOT, 'rules') })
    assert.ok(result.score >= 60, `expected score >= 60, got ${result.score}`)
    assert.ok(['A', 'B', 'C'].includes(result.grade), `expected grade A-C, got ${result.grade}`)
    assert.ok(result.checks.length >= 9)
    assert.ok(result.lastChecked)
    assert.ok(Array.isArray(result.warnings))
  })

  it('empty dir scores low', async () => {
    const dir = freshDir()
    const { assess } = await import('../src/extend/hooks/features/health/health.mjs')
    const result = assess(dir, { _rulesDir: join(dir, 'nonexistent') })
    assert.ok(result.score <= 30, `expected score <= 30, got ${result.score}`)
    assert.ok(['D', 'F'].includes(result.grade))
    assert.ok(result.warnings.length >= 5)
  })
})

// --- State + history ---

describe('health — state management', () => {
  it('stores and reads state file', async () => {
    const dir = freshDir()
    const { assess } = await import('../src/extend/hooks/features/health/health.mjs')
    const r1 = assess(dir)
    const r2 = assess(dir)
    // Second run should have history
    assert.ok(r2.trend, 'second run should have trend')
  })
})

// --- Feature execute (context format) ---

describe('health — feature execute', () => {
  it('returns formatted context string', async () => {
    const { execute } = await import('../src/extend/hooks/features/health/health.mjs')
    const result = execute({ cwd: ROOT }, { cache_minutes: 0 })
    assert.equal(typeof result, 'string')
    assert.ok(result.includes('[project-health]'))
    assert.ok(result.includes(ROOT))
    // Should contain a grade letter
    assert.ok(/— [A-F] \(/.test(result), `expected grade in output: ${result.slice(0, 100)}`)
  })
})
