// state.mjs — Per-session hook state dedup
// ObjectTree module: createState(config) → { hasFired, markFired, clearSession, dump, restore }
// Internal: Map<sessionId, Map<ruleName, timestamp>>
// Persistence: run/hook-state.json — written on every markFired + clearSession.
// oneshot mode: file is source of truth (new process each call).
// daemon mode: memory is primary, file is write-behind for crash recovery.

import { writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { ObjectTree } from '../../../lib/schema2object.mjs'

export function createState({ projectRoot, bus }, loader) {
  const stateFile = resolve(projectRoot, 'run', 'hook-state.json')
  const MAX_SESSIONS = 1000 // Prevent OOM from unbounded sessionId growth
  const _store = new Map() // Map<sessionId, Map<ruleName, timestamp>>
  const _sessionOrder = [] // Insertion order for O(1) eviction

  function _log(level, msg) {
    if (!bus) return
    bus.send('log', { ts: Date.now(), level, event: 'state', message: msg })
      .catch(e => { try { process.stderr.write(`[log-err] state ${e.message}\n`) } catch {} })
  }

  function _init() {
    if (!existsSync(stateFile)) return
    try {
      const raw = JSON.parse(readFileSync(stateFile, 'utf-8'))
      for (const [sessionId, entries] of Object.entries(raw)) {
        _store.set(sessionId, new Map(Object.entries(entries)))
      }
    } catch (e) {
      // Ignore corrupt state file, start fresh
    }
  }

  function _persist() {
    try {
      const dir = dirname(stateFile)
      mkdirSync(dir, { recursive: true })

      const data = {}
      for (const [sessionId, ruleTimes] of _store) {
        data[sessionId] = Object.fromEntries(ruleTimes)
      }

      const tmpFile = stateFile + '.tmp'
      writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8')
      renameSync(tmpFile, stateFile)
    } catch (e) {
      // Silently fail persistence; state stays in memory
    }
  }

  // Load persisted state at startup
  _init()

  let stateSchema
  try { stateSchema = loader?.resolve('../../extend/hooks/engine/state.schema.json')?.node } catch {}

  const tree = new ObjectTree({}, stateSchema || { type: 'object' }, loader)

  tree.hasFired = function(sessionId, ruleName, repeat) {
    const sessionId_ = sessionId || '__none__'

    // repeat=true or undefined: always fire
    if (repeat === true || repeat === undefined) {
      return false
    }

    // repeat=false: fire once per session
    if (repeat === false) {
      const result = _store.get(sessionId_)?.has(ruleName) ? true : false
      _log('debug', `hasFired session=${sessionId_} rule=${ruleName} repeat=false result=${result}`)
      return result
    }

    // repeat=integer (cooldown in seconds)
    if (typeof repeat === 'number' && repeat > 0) {
      const ruleTimes = _store.get(sessionId_)
      if (!ruleTimes || !ruleTimes.has(ruleName)) {
        _log('debug', `hasFired session=${sessionId_} rule=${ruleName} repeat=${repeat}s result=false (no record)`)
        return false
      }
      const lastTime = ruleTimes.get(ruleName)
      const elapsed = Date.now() - lastTime
      const result = elapsed < repeat * 1000
      _log('debug', `hasFired session=${sessionId_} rule=${ruleName} repeat=${repeat}s elapsed=${elapsed}ms result=${result}`)
      return result
    }

    // Default: no match
    return false
  }

  tree.markFired = function(sessionId, ruleName) {
    const sessionId_ = sessionId || '__none__'

    // OOM prevention: evict oldest 20% by insertion order (O(n) not O(n log n))
    if (_store.size >= MAX_SESSIONS && !_store.has(sessionId_)) {
      const evictCount = Math.ceil(MAX_SESSIONS * 0.2)
      const count = Math.min(evictCount, _sessionOrder.length)
      for (let i = 0; i < count; i++) {
        const evictId = _sessionOrder.shift()
        if (_store.has(evictId)) {
          _store.delete(evictId)
          _log('debug', `evicted session=${evictId} (OOM prevention)`)
        }
      }
    }

    if (!_store.has(sessionId_)) {
      _store.set(sessionId_, new Map())
      _sessionOrder.push(sessionId_)
    }
    _store.get(sessionId_).set(ruleName, Date.now())
    _persist()
    _log('debug', `markFired session=${sessionId_} rule=${ruleName}`)
  }

  tree.clearSession = function(sessionId) {
    const sessionId_ = sessionId || '__none__'
    _store.delete(sessionId_)
    const idx = _sessionOrder.indexOf(sessionId_)
    if (idx !== -1) _sessionOrder.splice(idx, 1)
    _persist()
  }

  tree.dump = function() {
    const data = {}
    for (const [sessionId, ruleTimes] of _store) {
      data[sessionId] = Object.fromEntries(ruleTimes)
    }
    return data
  }

  tree.restore = function(data) {
    _store.clear()
    _sessionOrder.length = 0
    for (const [sessionId, entries] of Object.entries(data)) {
      _store.set(sessionId, new Map(Object.entries(entries)))
      _sessionOrder.push(sessionId)
    }
  }

  return tree
}
