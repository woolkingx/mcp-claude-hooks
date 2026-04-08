// license.mjs — Check LICENSE file existence
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'license'
export const weight = 1

export function check(cwd) {
  const files = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'LICENCE']
  const found = files.find(f => existsSync(join(cwd, f)))
  if (found) return { status: 'pass', detail: `${found} found` }
  return { status: 'fail', detail: 'No license file found' }
}
