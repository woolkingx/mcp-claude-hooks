// bash-parser.mjs — Bash command parser facade (core lib utility)
// parse(command) → ObjectTree(ParseResult) — validated, schema-driven AST wrapper
// matchCommand(command, bashSchema) → boolean — one-shot: parse + filter + validate
// Command shape: { type, name: {text}, prefix: [{text}], suffix: [{text}], redirects: [{operator, content}] }

import { parse as compatParse } from './bash-compat.mjs'
import { ObjectTree, Loader, validate } from './schema2object.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

let _schema = null
let _loader = null

function ensureLoaded() {
  if (_schema) return
  const __dir = dirname(fileURLToPath(import.meta.url))
  const schemaPath = join(__dir, 'bash-parse-result.schema.json')
  _schema = JSON.parse(readFileSync(schemaPath, 'utf-8'))
  _loader = new Loader(_schema, join(__dir, '.'))
}

export function setSchemaContext(ctx) {
  if (ctx?.schemas?.bashParseResult) _schema = ctx.schemas.bashParseResult
  if (ctx?.loaders?.bashParseResult) _loader = ctx.loaders.bashParseResult
}

export function parse(command) {
  ensureLoaded()
  const result = compatParse(command)
  try {
    return new ObjectTree(result, _schema, _loader)
  } catch {
    return new ObjectTree({ type: 'error', commands: [], raw: command ?? '' }, _schema, _loader)
  }
}

// One-shot: command string + rule schema → boolean
// parse → filter Command nodes → validate each against bashSchema
export function matchCommand(command, bashSchema) {
  if (!command || typeof command !== 'string') return false
  const parsed = compatParse(command)
  if (!parsed || parsed.type === 'error') return false
  return parsed.commands
    .filter(cmd => cmd.type === 'Command')
    .some(cmd => validate(cmd, bashSchema).valid)
}
