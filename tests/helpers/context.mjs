// tests/helpers/context.mjs — shared test context factory
// node:test re-exports + project paths + mock factories

import { describe, it, before, after, beforeEach, afterEach } from 'node:test'
import { strict as assert } from 'node:assert'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'

export { describe, it, before, after, beforeEach, afterEach, assert }

export const ROOT = resolve(new URL('../..', import.meta.url).pathname)
export const CONFIG_DIR = join(ROOT, 'src', 'project', 'config')
export const HOOKS_SCHEMA_DIR = join(CONFIG_DIR, 'hooks')

// fresh isolated temp dir per call
let _idx = 0
const _base = join(tmpdir(), `hook-test-${Date.now()}`)
export function freshDir() {
  const dir = join(_base, String(_idx++))
  mkdirSync(dir, { recursive: true })
  return dir
}

// mock bus: intercept log, dispatch handlers
export function mockBus() {
  const handlers = new Map()
  const logs = []
  return {
    handle(event, fn) { handlers.set(event, fn) },
    unhandle(event) { handlers.delete(event) },
    has(event) { return handlers.has(event) },
    async send(event, payload) {
      if (event === 'log') { logs.push(payload); return }
      const h = handlers.get(event)
      if (!h) throw new Error(`no handler: ${event}`)
      return h(payload)
    },
    handlers, logs
  }
}

// load event schema for handler tests
export function loadEventSchema(eventName, Loader) {
  const p = join(HOOKS_SCHEMA_DIR, `${eventName}.json`)
  if (!existsSync(p)) return null
  const raw = JSON.parse(readFileSync(p, 'utf-8'))
  const loader = new Loader(raw, CONFIG_DIR)
  const responseSchema = raw.definitions?.response || null
  let hsoSchema = null
  const hsoNode = responseSchema?.properties?.hookSpecificOutput
  if (hsoNode?.['$ref']) {
    try { hsoSchema = loader.resolve(hsoNode['$ref'], loader.scopeOf(hsoNode), loader.resourceOf(hsoNode)).node }
    catch { /* no HSO */ }
  } else if (hsoNode?.properties) hsoSchema = hsoNode
  return { raw, loader, defs: raw.definitions || {}, responseSchema, hsoSchema }
}
