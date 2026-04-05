// Environment loader: .env file + process.env cascade
// Zero dependencies. Domain-agnostic.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Parse .env file into key=value pairs. Ignores comments and blank lines. */
function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const vars = {}
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    vars[key] = val
  }
  return vars
}

/**
 * Load .env file into process.env. Existing env vars take priority.
 * @param {string} [envPath] — path to .env file (default: project root)
 */
export function loadEnv(envPath) {
  const filePath = envPath || resolve(process.cwd(), '.env')
  const fileVars = parseEnvFile(filePath)
  for (const [k, v] of Object.entries(fileVars)) {
    if (process.env[k] === undefined) process.env[k] = v
  }
}

/**
 * Write a key=value to .env file. Updates existing key or appends.
 * @param {string} key
 * @param {string} value
 * @param {string} [envPath]
 */
export function saveEnv(key, value, envPath) {
  const filePath = envPath || resolve(process.cwd(), '.env')
  const lines = existsSync(filePath) ? readFileSync(filePath, 'utf-8').split('\n') : []
  let found = false
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('#') || !trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    if (trimmed.slice(0, eq).trim() === key) {
      lines[i] = `${key}=${value}`
      found = true
      break
    }
  }
  if (!found) lines.push(`${key}=${value}`)
  writeFileSync(filePath, lines.join('\n'))
  process.env[key] = value
}
