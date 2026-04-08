// claude-md.mjs — Check CLAUDE.md or .claude/ directory existence
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'claude_md'
export const weight = 3

export function check(cwd) {
  const paths = [
    join(cwd, '.claude', 'CLAUDE.md'),
    join(cwd, 'CLAUDE.md')
  ]
  const found = paths.find(p => existsSync(p))
  if (found) return { status: 'pass', detail: `${found.replace(cwd + '/', '')} found` }
  return { status: 'fail', detail: 'No CLAUDE.md found — project instructions missing' }
}
