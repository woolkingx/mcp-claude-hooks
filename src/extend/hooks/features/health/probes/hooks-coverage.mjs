// hooks-coverage.mjs — Check if any hook rules target this cwd
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'hooks_coverage'
export const weight = 2

export function check(cwd, config = {}) {
  const rulesDir = config._rulesDir
  if (!rulesDir || !existsSync(rulesDir)) {
    return { status: 'fail', detail: 'Rules directory not available' }
  }

  let count = 0
  const files = readdirSync(rulesDir).filter(f => f.endsWith('.json'))
  for (const f of files) {
    try {
      const rule = JSON.parse(readFileSync(join(rulesDir, f), 'utf-8'))
      if (!rule.cwd) continue
      const patterns = Array.isArray(rule.cwd) ? rule.cwd : [rule.cwd]
      for (const p of patterns) {
        if (cwd.includes(p) || new RegExp(p).test(cwd)) { count++; break }
      }
    } catch { /* skip invalid rule files */ }
  }

  if (count > 0) return { status: 'pass', detail: `${count} rule(s) target this directory` }
  return { status: 'fail', detail: 'No hook rules target this directory' }
}
