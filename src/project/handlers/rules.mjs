// rules.mjs — CRUD + validate + test for hook rules
// Rules stored as JSON files in rules/ directory, validated against rules.schema.json

import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, renameSync, mkdirSync, realpathSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Loader, ObjectTree } from '../../lib/schema2object.mjs'
import { matchesSchema } from '../../lib/hook-match.mjs'
import { generateTemplate } from './template.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..')

let rulesDir = null
let ruleSchema = null
let ruleLoader = null
let rulesCache = null  // Map<name, rule>
let _bus = null

export function setBus(bus) {
  _bus = bus
  // rules:changed → trigger reload pipeline (same path as MCP tools/call hooks_admin:reload)
  bus.handle('rules:changed', () => bus.send('hooks_admin:reload', {}))
}

export function setSchemaContext(ctx) {
  if (ctx?.schemas?.rules) ruleSchema = ctx.schemas.rules
  if (ctx?.loaders?.rules) ruleLoader = ctx.loaders.rules
}

function log(level, msg) {
  if (_bus) {
    _bus.send('log', { ts: Date.now(), level, msg, event: 'rules' }).catch(() => {})
  }
}

function init() {
  if (rulesDir) return
  rulesDir = resolve(PROJECT_ROOT, 'rules')
  // Fallback: load schema if not injected via setSchemaContext
  if (!ruleSchema) {
    const schemaPath = resolve(PROJECT_ROOT, 'src', 'project', 'config', 'rules.schema.json')
    if (existsSync(schemaPath)) {
      ruleSchema = JSON.parse(readFileSync(schemaPath, 'utf-8'))
      ruleLoader = new Loader(ruleSchema, resolve(PROJECT_ROOT, 'src', 'project', 'config'))
    }
  }
  loadAll()
}

function loadAll() {
  rulesCache = new Map()
  if (!existsSync(rulesDir)) return
  const realRulesDir = realpathSync(rulesDir)
  for (const file of readdirSync(rulesDir).filter(f => f.endsWith('.json')).sort()) {
    try {
      const filePath = join(rulesDir, file)
      const realPath = realpathSync(filePath)
      // Path traversal prevention: verify real path stays within rules directory
      if (!realPath.startsWith(realRulesDir)) {
        log('warn', `Blocked symlink traversal: ${file} resolves outside rules/`)
        continue
      }
      const raw = JSON.parse(readFileSync(realPath, 'utf-8'))
      rulesCache.set(raw.name, raw)
    } catch (e) {
      log('error', `Failed to load ${file}: ${e.message}`)
    }
  }
}

// --- Actions ---

function list({ enabled_only, event_type }) {
  init()
  let rules = [...rulesCache.values()]
  if (enabled_only) rules = rules.filter(r => r.enabled)
  if (event_type) rules = rules.filter(r => r.event === event_type)
  rules.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))
  return {
    count: rules.length,
    rules: rules.map(r => ({
      name: r.name,
      event: r.event,
      action: r.action,
      enabled: r.enabled ?? true,
      priority: r.priority ?? 50,
      tool: r.tool || null,
      cwd: r.cwd || null,
      description: r.description || ''
    }))
  }
}

function get({ name }) {
  init()
  const rule = rulesCache.get(name)
  if (!rule) return { error: `Rule not found: ${name}` }
  return rule
}

function create(input) {
  init()
  const name = input.name
  if (rulesCache.has(name)) return { error: `Rule already exists: ${name}` }

  let rule
  const c = input.content
  try {
    rule = typeof c === 'string' ? JSON.parse(c) : (c?.$toDict?.() ?? c)
  } catch (e) {
    return { error: `Invalid JSON: ${e.message}`, events: template({}).events?.map(e => e.name) }
  }
  rule.name = name
  const v = validateRule(rule)
  if (!v.valid) return v

  const validated = v.rule
  mkdirSync(rulesDir, { recursive: true })
  writeFileSync(join(rulesDir, `${name}.json`), JSON.stringify(validated, null, 2) + '\n')
  rulesCache.set(name, validated)
  _bus?.send('rules:changed', { name }).catch(() => {})
  return { created: name, rule: validated }
}

function update(input) {
  init()
  const name = input.name
  if (!rulesCache.has(name)) return { error: `Rule not found: ${name}` }

  let rule
  const c = input.content
  try {
    rule = typeof c === 'string' ? JSON.parse(c) : (c?.$toDict?.() ?? c)
  } catch (e) {
    return { error: `Invalid JSON: ${e.message}`, events: template({}).events?.map(e => e.name) }
  }
  rule.name = name
  const v = validateRule(rule)
  if (!v.valid) return v

  const validated = v.rule
  writeFileSync(join(rulesDir, `${name}.json`), JSON.stringify(validated, null, 2) + '\n')
  rulesCache.set(name, validated)
  _bus?.send('rules:changed', { name }).catch(() => {})
  return { updated: name, rule: validated }
}

function del({ name }) {
  init()
  if (!rulesCache.has(name)) return { error: `Rule not found: ${name}` }

  const filePath = join(rulesDir, `${name}.json`)
  const cleanupDir = resolve(PROJECT_ROOT, '.cleanup')
  mkdirSync(cleanupDir, { recursive: true })
  renameSync(filePath, join(cleanupDir, `${name}.json`))
  rulesCache.delete(name)
  _bus?.send('rules:changed', { name }).catch(() => {})
  return { deleted: name, moved_to: '.cleanup/' }
}

function toggle({ name, enabled }) {
  init()
  const rule = rulesCache.get(name)
  if (!rule) return { error: `Rule not found: ${name}` }

  rule.enabled = enabled
  writeFileSync(join(rulesDir, `${name}.json`), JSON.stringify(rule, null, 2) + '\n')
  rulesCache.set(name, rule)
  _bus?.send('rules:changed', { name }).catch(() => {})
  return { toggled: name, enabled }
}

function validateAction(input) {
  let rule
  const c = input.content
  try {
    rule = typeof c === 'string' ? JSON.parse(c) : (c?.$toDict?.() ?? c)
  } catch (e) {
    return { valid: false, error: `Invalid JSON: ${e.message}`, template: template({}) }
  }
  const result = validateRule(rule)
  if (!result.valid) return result
  // Also validate match/match_bash are valid Draft-07 if present
  const checks = []
  if (rule.match) checks.push({ field: 'match', schema: rule.match })
  if (rule.match_bash) checks.push({ field: 'match_bash', schema: rule.match_bash })
  for (const { field, schema } of checks) {
    if (!schema || typeof schema !== 'object') {
      return { valid: false, error: `${field} must be a Draft-07 schema object` }
    }
  }
  return result
}

function test({ name, event }) {
  init()
  if (!event) return { error: 'event is required' }

  // No name → real execution: pipe event through hook processor
  if (!name) {
    try {
      const result = execSync(
        `node ${join(PROJECT_ROOT, 'src', 'main.mjs')}`,
        { input: JSON.stringify(event), encoding: 'utf-8', timeout: 5000 }
      ).trim()
      return result ? JSON.parse(result) : { result: 'no output (no rules matched)' }
    } catch (e) {
      if (e.stdout?.trim()) {
        try { return JSON.parse(e.stdout.trim()) } catch {}
      }
      return { error: e.stderr?.trim() || e.message }
    }
  }

  // Named rule → test single rule
  const rule = rulesCache.get(name)
  if (!rule) return { error: `Rule not found: ${name}` }

  const ev = event?.$toDict?.() ?? event
  if (ev.hook_event_name && ev.hook_event_name !== rule.event) {
    return { matched: false, reason: `Event mismatch: ${ev.hook_event_name} !== ${rule.event}` }
  }
  if (rule.tool) {
    const tools = Array.isArray(rule.tool) ? rule.tool : [rule.tool]
    if (ev.tool_name && !tools.includes(ev.tool_name)) {
      return { matched: false, reason: `Tool mismatch: ${ev.tool_name} not in [${tools}]` }
    }
  }

  try {
    const matched = matchesSchema(rule, event)
    if (matched) return { matched: true, action: rule.action, reason: rule.reason || null }

    // Explain why match failed
    const data = event?.$toDict?.() ?? event
    let detail = 'Schema match returned false'
    if (rule.match_bash) {
      detail = 'match_bash: no Command node matched the schema'
    } else if (rule.match) {
      try { new ObjectTree(data, rule.match) }
      catch (e) { detail = `match failed: ${e.message}` }
    }
    return { matched: false, reason: detail }
  } catch (e) {
    return { matched: false, reason: `Schema match error: ${e.message}` }
  }
}

// --- Helpers ---

function validateRule(rule) {
  if (!ruleSchema) return { valid: true, warning: 'Schema not loaded, skipping validation' }
  try {
    const tree = new ObjectTree(rule, ruleSchema.definitions.Rule, ruleLoader)
    return { valid: true, rule: tree.$toDict() }
  } catch (e) {
    const raw = template({ event: rule.event })
    const t = rule.event
      ? { rule_skeleton: raw.rule_skeleton }
      : { events: raw.events?.map(e => e.name) }
    return { valid: false, error: e.message, template: t }
  }
}

// --- Public: for hook processor ---

export function getRulesForEvent(eventName) {
  init()
  return [...rulesCache.values()]
    .filter(r => r.enabled !== false && r.event === eventName)
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))
}

export function reload() {
  rulesDir = null
  rulesCache = null
  init()
}

// --- Template: delegates to template.mjs ---

function template({ event }) {
  init()
  const result = generateTemplate(event, { ruleSchema })
  // Enrich list mode with rule counts
  if (!event && result.events) {
    for (const ev of result.events) {
      ev.rules = [...rulesCache.values()].filter(r => r.enabled !== false && r.event === ev.name).length
    }
  }
  return result
}

export const handlers = {
  list, get, create, update,
  delete: del,
  toggle,
  validate: validateAction,
  test,
  template,
  reload: () => { reload(); return { reloaded: true } }
}
