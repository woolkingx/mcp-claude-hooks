// readme.mjs — Check README existence
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'readme'
export const weight = 1

export function check(cwd) {
  const files = ['README.md', 'README', 'README.txt', 'readme.md']
  const found = files.find(f => existsSync(join(cwd, f)))
  if (found) return { status: 'pass', detail: `${found} found` }
  return { status: 'fail', detail: 'No README found' }
}
