// engine.mjs — Hook processing pipeline
// Receives rules and features as object modules (dependency injection)
// Rules: O(1) direct fn call, Handlers: per-event dispatcher, Responses: merged

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ObjectTree } from '../../../lib/schema2object.mjs'
import { matchesSchema } from './hook-match.mjs'
import { getHandler } from '../handles/index.mjs'
import { merge } from './merger.mjs'

// Log factory: creates a (level, msg, extra?) fn bound to bus + prefix
// bus.send is async — use .catch to handle rejection, not try/catch
function createLog(bus, prefix) {
  return function _log(level, msg, extra) {
    if (!bus) return
    bus.send('log', { ts: Date.now(), level, event: prefix, message: msg, ...(extra || {}) })
      .catch(e => { try { process.stderr.write(`[log-err] ${prefix} ${e.message}\n`) } catch {} })
  }
}

function _isPaused(projectRoot) {
  const envFile = resolve(projectRoot, '.env')
  if (!existsSync(envFile)) return false
  const m = readFileSync(envFile, 'utf-8').match(/^HOOKS_PAUSED=(.+)$/m)
  return m && m[1].trim() === '1'
}

function _expandShorthand(rule) {
  if (!rule.tool && !rule.cwd) return rule
  const match = { ...rule.match }
  if (!match.properties) match.properties = {}

  if (rule.tool) {
    if (typeof rule.tool === 'string') {
      match.properties.tool_name = { const: rule.tool }
    } else if (Array.isArray(rule.tool)) {
      match.properties.tool_name = { enum: rule.tool }
    }
  }

  if (rule.cwd) {
    if (typeof rule.cwd === 'string') {
      match.properties.cwd = { pattern: rule.cwd }
    } else if (Array.isArray(rule.cwd)) {
      match.properties.cwd = { anyOf: rule.cwd.map(p => ({ pattern: p })) }
    }
  }

  return { ...rule, match }
}

export function createEngine({ rules, features, state, config = {}, projectRoot, bus, loader }) {
  const log = createLog(bus, 'engine')
  const matchLog = createLog(bus, 'engine:match')
  const mergeLog = createLog(bus, 'engine:merge')

  async function processEvent(event) {
    const eventName = event.hook_event_name
    if (!eventName) return null

    const tool = event.tool_name || ''
    const tag = `${eventName}${tool ? ':' + tool : ''}`

    // Get rules via direct fn call (no bus)
    const candidates = rules.get(eventName)
    const matchResults = await Promise.all(candidates.map(async rule => {
      const expanded = _expandShorthand(rule)
      if (!matchesSchema(expanded, event, matchLog)) return { rule: expanded, matched: false, why: 'schema' }
      return { rule: expanded, matched: true }
    }))

    // Log all match results at debug level
    for (const r of matchResults) {
      matchLog('debug', `${tag} rule=${r.rule.name} ${r.matched ? 'HIT' : 'MISS:' + r.why}`)
    }

    const matched = matchResults.filter(r => r.matched).map(r => r.rule)

    // Log event summary with input snapshot
    log('debug', `${tag} candidates=${candidates.length} matched=${matched.length}`, { input: event })

    if (_isPaused(projectRoot) && eventName === 'PreToolUse') {
      log('info', `${tag} PAUSED — injecting allow`)
      matched.push({ name: 'paused', action: 'allow', reason: '[PAUSED] Hook rules suspended', enabled: true })
    }

    let output = null
    if (matched.length) {
      let schema = null
      const eventSchemaRef = `hooks/${eventName}.json`
      try {
        const resolved = loader.resolve(eventSchemaRef)
        const raw = resolved.node || resolved
        const responseSchema = raw.definitions?.response || null
        schema = { raw, loader: resolved.loader || loader, responseSchema }
      } catch (e) {
        log('debug', `schema resolve error: ${eventName} ${e.message}`)
      }

      if (schema) {
        const handler = getHandler(eventName)
        const handlerLog = createLog(bus, `handle:${eventName}`)
        const sessionId = event.session_id || '__none__'
        const DEDUP_ACTIONS = ['context', 'welcome', 'load', 'transform']
        const pending = []
        for (const rule of matched) {
          const fired = state.hasFired(sessionId, rule.name, rule.repeat)
          if (!fired) state.markFired(sessionId, rule.name)
          if (fired && DEDUP_ACTIONS.includes(rule.action)) {
            handlerLog('debug', `rule=${rule.name} action=${rule.action} SKIP (fired)`)
            continue
          }
          handlerLog('debug', `rule=${rule.name} action=${rule.action} fired=${fired}`)
          const featureResult = rule.feature ? features.execute(rule.feature, event) : null
          pending.push({ rule, promise: handler({ rule, event, schema, log: handlerLog, featureResult }) })
        }
        const results = await Promise.all(pending.map(p => p.promise))
        if (results.length === 1) {
          output = results[0]
        } else if (results.length > 1) {
          mergeLog('debug', `${tag} merging ${results.length} responses`)
          output = merge(
            results.map((resp, i) => ({
              resp: resp instanceof ObjectTree ? resp : new ObjectTree(resp, schema.responseSchema, schema.loader),
              rule: { name: pending[i].rule.name, action: pending[i].rule.action }
            })),
            mergeLog
          )
        }
      }
    }

    // Return output as dict (handlers return ObjectTree)
    const result = output instanceof ObjectTree ? output.$toDict() : output
    log('debug', `${tag} result=${result ? JSON.stringify(result).slice(0, 200) : 'null'}`)
    return result
  }

  let engineSchema
  try { engineSchema = loader?.resolve('../../extend/hooks/engine/engine.schema.json')?.node } catch {}

  const tree = new ObjectTree({}, engineSchema || { type: 'object' }, loader)

  tree.processEvent = processEvent

  tree.loadEventSchema = (name) => {
    try { return loader.resolve(`hooks/${name}.json`) }
    catch { return null }
  }

  Object.defineProperty(tree, 'paused', {
    get() { return _isPaused(projectRoot) },
    enumerable: true
  })

  return tree
}
