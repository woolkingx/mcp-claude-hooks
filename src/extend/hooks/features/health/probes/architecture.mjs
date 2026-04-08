// architecture.mjs — Check architecture documentation existence
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'architecture'
export const weight = 2

export function check(cwd) {
  // Check common architecture doc locations
  const files = [
    join(cwd, 'architecture.schema.json'),
    join(cwd, 'architecture.md'),
    join(cwd, 'docs', 'architecture.md'),
    join(cwd, 'docs', 'architecture.schema.json')
  ]
  const found = files.find(p => existsSync(p))
  if (found) return { status: 'pass', detail: `${found.replace(cwd + '/', '')} found` }

  // Check .claude/rules/ directory has content
  const rulesDir = join(cwd, '.claude', 'rules')
  if (existsSync(rulesDir)) {
    const entries = readdirSync(rulesDir).filter(f => f.endsWith('.md'))
    if (entries.length > 0) return { status: 'pass', detail: `.claude/rules/ has ${entries.length} docs` }
  }

  return { status: 'fail', detail: 'No architecture docs — module boundaries undocumented' }
}
