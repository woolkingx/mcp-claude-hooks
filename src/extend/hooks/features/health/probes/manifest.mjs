// manifest.mjs — Check project manifest existence
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'manifest'
export const weight = 1

export function check(cwd) {
  const files = ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'Makefile', 'CMakeLists.txt']
  const found = files.find(f => existsSync(join(cwd, f)))
  if (found) return { status: 'pass', detail: `${found} found` }
  return { status: 'fail', detail: 'No project manifest found' }
}
