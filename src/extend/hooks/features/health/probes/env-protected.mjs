// env-protected.mjs — Check if .env files are protected by deny/ask rules
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'env_protected'
export const weight = 1

export function check(_cwd, config = {}) {
  const rulesDir = config._rulesDir
  if (!rulesDir || !existsSync(rulesDir)) {
    return { status: 'fail', detail: 'Rules directory not available' }
  }

  const files = readdirSync(rulesDir).filter(f => f.endsWith('.json'))
  for (const f of files) {
    try {
      const rule = JSON.parse(readFileSync(join(rulesDir, f), 'utf-8'))
      if (rule.enabled === false) continue
      if (rule.action !== 'deny' && rule.action !== 'ask') continue
      const src = JSON.stringify(rule)
      if (src.includes('.env') || src.includes('env')) {
        return { status: 'pass', detail: `${rule.name} protects .env files` }
      }
    } catch { /* skip */ }
  }

  return { status: 'fail', detail: 'No .env protection rule found' }
}
