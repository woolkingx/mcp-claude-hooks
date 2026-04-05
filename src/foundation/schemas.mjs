// schemas.mjs — L1 schema context loader
// Loads all static schemas once, returns { schemas, loaders, configDir }
// Consumers receive via ctx injection — no per-module Loader instantiation.

import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { Loader } from '../lib/schema2object.mjs'

export function loadSchemas(configDir) {
  function load(file) { return JSON.parse(readFileSync(join(configDir, file), 'utf8')) }

  const hooksDir = join(configDir, 'hooks')
  const runtime = load('runtime.schema.json')
  const tools = load('tools.json')
  const rules = load('rules.schema.json')
  const libDir = join(configDir, '..', '..', 'lib')
  const bashParseResult = JSON.parse(readFileSync(join(libDir, 'bash-parse-result.schema.json'), 'utf8'))

  return {
    schemas: { runtime, tools, rules, bashParseResult, hooksDir },
    loaders: {
      runtime: new Loader(runtime, configDir),
      tools: new Loader(tools, configDir),
      rules: new Loader(rules, configDir),
      bashParseResult: new Loader(bashParseResult, libDir),
    },
    configDir
  }
}
