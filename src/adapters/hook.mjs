// hook adapter — stdin event → hooks:process-event → stdout → exit
// IO conversion only. Log goes through bus.
// When hooksLoader available, builds ObjectTree for schema validation.

import { ObjectTree } from '../lib/schema2object.mjs'

async function hookLog(bus, level, message, extra = {}) {
  try { await bus.send('log', { ts: Date.now(), level, event: 'hook', message, ...extra }) } catch {}
}

export async function runHook(core) {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const input = Buffer.concat(chunks).toString('utf-8').trim()
  if (!input) return

  let raw
  try { raw = JSON.parse(input) }
  catch (e) {
    await hookLog(core.bus, 'error', `Invalid JSON: ${e.message}`, { error: e.message, stack: e.stack })
    process.exit(1)
  }

  // Build ObjectTree from event input schema — validates + becomes live object
  const loader = core.hooksLoader || null
  let event = raw
  if (loader && raw.hook_event_name) {
    try {
      const resolved = loader.resolve(`hooks/${raw.hook_event_name}.json`)
      const schema = resolved.node || resolved
      const inputSchema = schema.definitions?.event || schema
      event = new ObjectTree(raw, inputSchema, loader)
    } catch (e) {
      await hookLog(core.bus, 'warn', `event validation: ${e.message}`, { error: e.message })
      // Fall through with raw — engine will still process
    }
  }

  const t0 = Date.now()
  let response = null
  let processError = null
  try {
    response = await core.bus.send('hooks:process-event', event)
  } catch (err) {
    processError = err
    await hookLog(core.bus, 'error', `engine error: ${err.message}`, { error: err.message, stack: err.stack })
  }
  const duration = Date.now() - t0

  if (response) process.stdout.write(JSON.stringify(response) + '\n')

  const ev = raw.hook_event_name || '?'
  const tool = raw.tool_name ? ` ${raw.tool_name}` : ''
  const denied = response ? (response.continue === false ? 'DENY' : 'ok') : '-'
  await hookLog(core.bus, 'info', `${ev}${tool} ${denied} ${duration}ms`, { duration })

  if (processError) {
    process.exit(1)
  }
}
