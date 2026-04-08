// mcp.mjs — Boot the one backend. All modes share this.
// hook → bus.send('hooks:process-event', event)
// CLI/stdio/sse → core.handle(jsonrpc)

import { join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { loadEnv } from './foundation/env.mjs'
import { createBus } from './foundation/bus.mjs'
import { createLifecycle } from './foundation/lifecycle.mjs'
import { loadSchemas } from './foundation/schemas.mjs'
import { createLogger } from './server/log.mjs'
import { ObjectTree } from './lib/schema2object.mjs'
import { createDispatch } from './server/dispatch.mjs'
import { createTransport } from './server/protocol.mjs'
import { setSchemaContext as setBashParserSchemas } from './lib/bash-parser.mjs'
import { setup as setupHooks } from './extend/hooks/hook.mjs'
import { handlers as adminHandlers } from './project/handlers/admin.mjs'
import { handlers as rulesHandlers, setBus, setSchemaContext } from './project/handlers/rules.mjs'

export function boot(overrides = {}) {
  const PROJECT_ROOT = resolve(import.meta.dirname, '..')
  loadEnv(join(PROJECT_ROOT, '.env'))
  const CONFIG_DIR = join(import.meta.dirname, 'project', 'config')

  const argv = process.argv.slice(2)
  const { isDaemon, ...schemaOverrides } = overrides
  const localOverrides = { ...schemaOverrides }
  if (argv.includes('--debug')) localOverrides.log = { level: 'debug' }
  if (argv.includes('--cli') || argv[0] === 'cli') {
    localOverrides.log = { level: 'fatal' }
  }

  // L1: schemas, runtime config, bus, logger
  const { schemas, loaders, configDir } = loadSchemas(CONFIG_DIR)
  const rt = new ObjectTree(localOverrides, schemas.runtime, loaders.runtime).$withDefaults()
  const bus = createBus()
  const logConfig = rt.log.$toDict()
  // Env var override: MCP_HOOKS_LOG_LEVEL sets both file + console level
  const envLevel = process.env.MCP_HOOKS_LOG_LEVEL
  if (envLevel && ['trace','debug','info','warn','error','fatal'].includes(envLevel)) {
    logConfig.level = envLevel
    if (logConfig.console) logConfig.console.level = envLevel
  }
  if (logConfig.logDir) {
    logConfig.logDir = resolve(PROJECT_ROOT, logConfig.logDir)
    try { mkdirSync(logConfig.logDir, { recursive: true }) } catch {}
  }
  createLogger(bus, logConfig)
  setBashParserSchemas({ schemas, loaders })

  // Extend: hooks root (rules + features + engine)
  const hooks = setupHooks(bus, { projectRoot: PROJECT_ROOT, rulesDir: 'rules', schemas, loaders, isDaemon })
  const hooksTeardown = hooks.teardown
  const hooksLoader = hooks.loader

  // engine:reload handled by hook.mjs (rules.reload() fn call)

  const ctx = { configDir, schemas, loaders, output: rt.output, runtime: rt, bus, lifecycle: null, transport: null }

  // Rules CRUD (hooks_rules:*)
  setBus(bus)
  setSchemaContext(ctx)
  for (const [action, fn] of Object.entries(rulesHandlers)) {
    bus.handle(`hooks_rules:${action}`, (input) => fn(input, ctx))
  }

  // rules:changed handler registered inside setBus() (rules module owns its own reload trigger)

  // Admin (hooks_admin:*) — pure binding, no orchestration logic
  for (const [action, fn] of Object.entries(adminHandlers)) {
    bus.handle(`hooks_admin:${action}`, async (input) => fn(input, ctx))
  }

  // JSON-RPC dispatch (management interface)
  const lifecycle = createLifecycle(rt.lifecycle, async () => {}, bus)
  ctx.lifecycle = lifecycle
  const { getToolList } = createDispatch(bus, schemas.tools, loaders.tools, {}, ctx)

  const transport = createTransport(bus, {
    toolList: getToolList(),
    serverInfo: rt.server,
    protocolVersion: rt.protocolVersion,
    errorCodes: rt.errorCodes,
    capabilities: { tools: { listChanged: true }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false }, logging: {} }
  })
  ctx.transport = transport

  bus.handle('resources/list', () => ({ resources: [] }))
  bus.handle('resources/templates/list', () => ({ resourceTemplates: [] }))
  bus.handle('resources/read', (p) => { throw new Error(`Resource not found: ${p?.uri}`) })
  bus.handle('prompts/list', () => ({ prompts: [] }))
  bus.handle('prompts/get', (p) => { throw new Error(`Prompt not found: ${p?.name}`) })
  bus.handle('completion/complete', () => ({ completion: { values: [] } }))
  bus.handle('logging/setLevel', ({ level }) => { rt.log.level = level })

  async function handle(message) {
    const reqId = bus.newRequest()
    try {
      const validated = await bus.send('validate', message, reqId)
      return await bus.send('route', validated, reqId)
    } catch (err) {
      bus.send('log', { ts: Date.now(), level: 'error', msg: `Internal error: ${err.message}`, event: 'server' }).catch(() => {})
      return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: rt.errorCodes.INTERNAL_ERROR, message: 'Internal error' } }
    }
  }

  // CoreShape: cold start — all fields populated
  const core = { handle, bus, errorCodes: rt.errorCodes, lifecycle, runtime: rt, transport, hooksLoader }
  return { bus, handle, core }
}
