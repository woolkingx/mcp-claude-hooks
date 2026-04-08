// git-state.mjs — Check git repo status: last commit age, dirty state
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'git_active'
export const weight = 2

export function check(cwd, config = {}) {
  const staleDays = config.stale_days || 14

  if (!existsSync(join(cwd, '.git'))) {
    return { status: 'fail', detail: 'Not a git repository' }
  }

  let lastTs
  try {
    const out = execSync('git log -1 --format=%ct', { cwd, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    lastTs = parseInt(out, 10)
  } catch {
    return { status: 'fail', detail: 'No git commits found' }
  }

  const ageDays = Math.floor((Date.now() / 1000 - lastTs) / 86400)
  if (ageDays > staleDays) {
    return { status: 'fail', detail: `Last commit ${ageDays} days ago — exceeds ${staleDays}d threshold` }
  }

  // Check dirty state (informational, doesn't fail)
  let dirty = false
  try {
    const st = execSync('git status --porcelain', { cwd, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    dirty = st.length > 0
  } catch { /* ignore */ }

  const detail = `Last commit ${ageDays}d ago${dirty ? ' (working tree dirty)' : ''}`
  return { status: 'pass', detail }
}
