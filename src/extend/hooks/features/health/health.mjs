// health.mjs — Project health assessment feature
// Probe-based scoring with per-cwd state tracking.
// Interface: export name + execute(event, config) — same as lint, doc-size-checker.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runProbes } from './probes/index.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..', '..')
const HEALTH_DIR = join(PROJECT_ROOT, 'run', 'health')
const RULES_DIR = join(PROJECT_ROOT, 'rules')

export const name = 'health'

// --- State helpers ---

function _cwdHash(cwd) {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 16)
}

function _stateFile(cwd) {
  return join(HEALTH_DIR, `${_cwdHash(cwd)}.json`)
}

function _readState(cwd) {
  const file = _stateFile(cwd)
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf-8')) }
  catch { return null }
}

function _writeState(cwd, state) {
  if (!existsSync(HEALTH_DIR)) mkdirSync(HEALTH_DIR, { recursive: true })
  writeFileSync(_stateFile(cwd), JSON.stringify(state, null, 2), 'utf-8')
}

// --- Scoring ---

function _grade(pct) {
  if (pct >= 90) return 'A'
  if (pct >= 75) return 'B'
  if (pct >= 60) return 'C'
  if (pct >= 45) return 'D'
  return 'F'
}

function _trend(history) {
  if (history.length < 2) return 'new'
  const newest = history[0].score
  const oldest = history[history.length - 1].score
  const diff = newest - oldest
  if (diff > 5) return 'improving'
  if (diff < -5) return 'degrading'
  return 'stable'
}

const _TREND_ARROWS = { improving: ' ↑improving', degrading: ' ↓degrading', stable: ' →stable', new: '' }

// --- Context format ---

function _formatContext(result) {
  const arrow = _TREND_ARROWS[result.trend] || ''
  const lines = [`[project-health] ${result.cwd} — ${result.grade} (${result.score}/${result.maxScore})${arrow}`]
  if (result.warnings.length > 0) {
    lines.push('Warnings:')
    for (const w of result.warnings) lines.push(`- ${w}`)
  }
  return lines.join('\n')
}

// --- Main execute ---

export function execute(event, config = {}) {
  const cwd = event.cwd || event.tool_input?.cwd || process.cwd()
  const cacheMinutes = config.cache_minutes ?? 30

  // Cache check
  if (cacheMinutes > 0) {
    const state = _readState(cwd)
    if (state?.lastFull) {
      const ageMs = Date.now() - new Date(state.lastFull.lastChecked).getTime()
      if (ageMs < cacheMinutes * 60 * 1000) {
        return _formatContext(state.lastFull)
      }
    }
  }

  // Run probes — inject internal config for probes that need rules dir
  const probeConfig = { ...config, _rulesDir: RULES_DIR }
  const checks = runProbes(cwd, probeConfig)

  // Score
  const maxScore = checks.reduce((sum, c) => sum + c.weight, 0)
  const rawScore = checks.filter(c => c.status === 'pass').reduce((sum, c) => sum + c.weight, 0)
  const score = maxScore > 0 ? Math.round(rawScore / maxScore * 100) : 0
  const gradeStr = _grade(score)

  // Warnings = failed checks
  const warnings = checks.filter(c => c.status === 'fail').map(c => c.detail)

  // Build result
  const now = new Date().toISOString()
  const result = { cwd, score, maxScore: 100, grade: gradeStr, trend: 'new', checks, warnings, lastChecked: now }

  // Update state + history
  const prev = _readState(cwd)
  const history = prev?.history || []
  history.unshift({ ts: now, score, grade: gradeStr })
  if (history.length > 3) history.length = 3
  result.trend = _trend(history)

  _writeState(cwd, { cwd, history, lastFull: result, trend: result.trend })

  return _formatContext(result)
}

// Direct access for MCP admin tool (returns structured data, not formatted string)
export function assess(cwd, config = {}) {
  const probeConfig = { ...config, _rulesDir: RULES_DIR }
  const checks = runProbes(cwd, probeConfig)
  const maxScore = checks.reduce((sum, c) => sum + c.weight, 0)
  const rawScore = checks.filter(c => c.status === 'pass').reduce((sum, c) => sum + c.weight, 0)
  const score = maxScore > 0 ? Math.round(rawScore / maxScore * 100) : 0
  const warnings = checks.filter(c => c.status === 'fail').map(c => c.detail)
  const now = new Date().toISOString()

  const prev = _readState(cwd)
  const history = prev?.history || []
  history.unshift({ ts: now, score, grade: _grade(score) })
  if (history.length > 3) history.length = 3
  const trend = _trend(history)

  const result = { cwd, score, maxScore: 100, grade: _grade(score), trend, checks, warnings, lastChecked: now }
  _writeState(cwd, { cwd, history, lastFull: result, trend })
  return result
}
