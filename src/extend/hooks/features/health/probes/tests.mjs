// tests.mjs — Check test directory existence
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'tests'
export const weight = 2

export function check(cwd) {
  const dirs = ['tests', 'test', '__tests__', 'spec']
  const found = dirs.find(d => existsSync(join(cwd, d)))
  if (found) return { status: 'pass', detail: `${found}/ directory found` }
  return { status: 'fail', detail: 'No test directory found' }
}
