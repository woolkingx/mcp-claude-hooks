// template.mjs — Generate full-field rule templates from event schemas
// Pure fn: generateTemplate(eventName, { hooksDir, ruleSchema, baseSchema }) → object
// No bus, no side effects. Reads schema files only.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..')
const DEFAULT_HOOKS_DIR = resolve(PROJECT_ROOT, 'src', 'project', 'config', 'hooks')

// --- Helpers ---

function _fieldHint(prop) {
  if (prop.const) return { const: prop.const }
  if (prop.enum) return { enum: prop.enum }
  if (prop.type === 'string') return { pattern: '?' }
  if (prop.type === 'array') return { contains: {} }
  if (prop.type === 'object' || prop.properties) return { properties: {} }
  return {}
}

function _expandMatchFields(eventDef) {
  const match = { properties: {} }
  if (!eventDef?.properties) return match
  for (const [k, v] of Object.entries(eventDef.properties)) {
    if (k === 'hook_event_name') continue
    match.properties[k] = _fieldHint(v)
  }
  return match
}

function _expandMatchBash(ruleSchema) {
  const unbash = ruleSchema?.definitions?.UnbashCommand
  if (!unbash?.properties) return null
  return {
    properties: {
      name: { properties: { text: { const: '?' } } },
      suffix: { contains: { properties: { text: { const: '?' } } } },
      redirects: { contains: { properties: { operator: { enum: ['>', '>>'] } } } }
    },
    required: ['name']
  }
}

function _expandHSO(eventName, baseSchema) {
  const defName = `${eventName}HookSpecificOutput`
  const hsoDef = baseSchema?.definitions?.[defName]
  if (!hsoDef?.properties) return null
  const hso = { hookEventName: eventName }
  for (const [k, v] of Object.entries(hsoDef.properties)) {
    if (k === 'hookEventName') continue
    if (v.type === 'string') hso[k] = ''
    else if (v.type === 'array') hso[k] = []
    else if (v.type === 'object') hso[k] = {}
    else if (v.type === 'boolean') hso[k] = false
    else if (v.enum) hso[k] = `<${v.enum.join('|')}>`
    else if (v.anyOf) hso[k] = '<?>'
    else hso[k] = null
  }
  return hso
}

function _expandResponse(eventSchema, baseSchema, eventName) {
  const respDef = eventSchema?.definitions?.response
  if (!respDef?.properties) return null
  const resp = {}
  for (const [k, v] of Object.entries(respDef.properties)) {
    if (k === 'hookSpecificOutput') {
      resp.hookSpecificOutput = _expandHSO(eventName, baseSchema) || {}
      continue
    }
    if (v.type === 'boolean') resp[k] = false
    else if (v.type === 'string') resp[k] = ''
    else if (v.enum) resp[k] = `<${v.enum.join('|')}>`
    else resp[k] = null
  }
  return resp
}

function _actionEnum(ruleSchema) {
  return ruleSchema?.definitions?.Action?.enum || ['deny', 'allow', 'ask', 'context']
}

function _featureNames() {
  return ['lint', 'doc-size-checker', 'agent']
}

// --- Public ---

export function listEvents({ hooksDir } = {}) {
  const dir = hooksDir || DEFAULT_HOOKS_DIR
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.json') && f !== 'base.schema.json')
    .map(f => f.replace('.json', ''))
    .sort()
}

export function generateTemplate(eventName, { hooksDir, ruleSchema, baseSchema } = {}) {
  const dir = hooksDir || DEFAULT_HOOKS_DIR

  // No event → list all
  if (!eventName) {
    const events = listEvents({ hooksDir: dir })
    return {
      count: events.length,
      events: events.map(name => ({ name })),
      usage: 'Pass event=<EventName> to get full rule template.'
    }
  }

  const schemaPath = join(dir, `${eventName}.json`)
  if (!existsSync(schemaPath)) {
    return { error: `No schema for event: ${eventName}`, available: listEvents({ hooksDir: dir }) }
  }

  // Load schemas
  const eventSchema = JSON.parse(readFileSync(schemaPath, 'utf-8'))
  const eventDef = eventSchema.definitions?.event
  if (!eventDef?.properties) {
    return { error: `Event schema ${eventName} has no field definitions` }
  }

  let base = baseSchema
  if (!base) {
    const basePath = join(dir, 'base.schema.json')
    if (existsSync(basePath)) base = JSON.parse(readFileSync(basePath, 'utf-8'))
  }

  // Detect tool-related event
  const hasTool = 'tool_name' in eventDef.properties

  // Build match section from event input schema
  const match = _expandMatchFields(eventDef)

  // Build match_bash (only for tool events)
  const matchBash = hasTool ? _expandMatchBash(ruleSchema) : null

  // Build response template
  const response = _expandResponse(eventSchema, base, eventName)

  // Actions
  const actions = _actionEnum(ruleSchema)

  // Full rule skeleton
  const skeleton = {
    name: `my-${eventName.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')}-rule`,
    description: '',
    event: eventName,
    enabled: true,
    priority: 50,
    repeat: true,

    action: `<${actions.join('|')}>`,
    reason: '',

    // Shorthand (tool events only)
    ...(hasTool ? { tool: '?string | string[]' } : {}),
    cwd: '?string | string[]',

    match,
    ...(matchBash ? { match_bash: matchBash } : {}),

    feature: {
      name: `<${_featureNames().join('|')}>`,
      config: {}
    },

    ...(hasTool ? {
      transform: {},
      updatedInput: { field: 'command', pattern: '', replace: '' }
    } : {}),

    loaders: [{ type: 'file', path: '?', label: '?' }],
    tags: [],
    agent: { model: '?', tools: [], prompt: '?' },

    response
  }

  // Event field reference
  const fields = {}
  for (const [k, v] of Object.entries(eventDef.properties)) {
    if (k === 'hook_event_name') continue
    const entry = { type: v.type || 'any' }
    if (v.const) entry.value = v.const
    if (v.enum) entry.values = v.enum
    if (v.description) entry.description = v.description
    if (eventDef.required?.includes(k)) entry.required = true
    fields[k] = entry
  }

  return {
    event: eventName,
    fields,
    actions,
    rule_skeleton: skeleton
  }
}
