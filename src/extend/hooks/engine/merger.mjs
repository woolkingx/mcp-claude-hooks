// merger.mjs — Multi-response merge engine
// Pure function: N handler responses → final output via decision priority
// No side effects, no bus, no external imports.

/**
 * Merge multiple handler responses into a single final response.
 *
 * @param {Array<{resp, rule}>} responses - Array of responses with metadata
 *   resp: ObjectTree response object
 *   rule: { name: string, action: string }
 * @param {Function} [log] - Optional log function (level, msg)
 * @returns {Object|null} Merged response dict, or null if empty input
 *
 * Priority: deny > ask > block > allow > context
 *
 * PostToolUse block: { continue: false } (no permissionDecision)
 * PreToolUse block: { hookSpecificOutput: { permissionDecision: 'deny' } }
 *
 * Reasons: newline-joined with [ruleName:action] tags
 * updatedInput: Object.assign (last wins per key)
 * additionalContext / systemMessage: newline-joined
 */
function _noop() {}

export function merge(responses, log) {
  const _log = log || _noop
  if (!Array.isArray(responses) || !responses.length) return null
  if (responses.length === 1) return _deepClone(responses[0].resp.$toDict())

  const decisions = responses.map(e => _getDecision(e.resp))

  _log('debug', `decisions: ${responses.map((e, i) => `${e.rule.name}=${decisions[i]}`).join(', ')}`)

  // Priority: deny > ask > block > allow > context
  for (const priority of ['deny', 'ask']) {
    const filtered = responses.filter((_, i) => decisions[i] === priority)
    if (filtered.length) {
      _log('debug', `winner: ${priority} (${filtered.map(e => e.rule.name).join(',')})`)
      return _mergePriority(priority, filtered)
    }
  }

  // block: only relevant for PostToolUse (continue: false)
  const blocked = responses.filter((_, i) => decisions[i] === 'block')
  if (blocked.length) {
    _log('debug', `winner: block (${blocked.map(e => e.rule.name).join(',')})`)
    return _mergeBlock(blocked)
  }

  // allow: merge updatedInput from all allow responses
  const allows = responses.filter((_, i) => decisions[i] === 'allow')
  if (allows.length) {
    _log('debug', `winner: allow (${allows.map(e => e.rule.name).join(',')})`)
    return _mergeAllow(allows)
  }

  // context: additionalContext or systemMessage, no decision
  const ctxs = responses.filter(e => {
    const hso = e.resp.hookSpecificOutput
    return (hso?.additionalContext || e.resp.systemMessage)
  })
  if (ctxs.length) {
    return _mergeContext(ctxs)
  }

  return _deepClone(responses[0].resp.$toDict())
}

// --- Priority merge (deny/ask) ---

function _mergePriority(priority, filtered) {
  const reasons = filtered.map(e => {
    const hso = e.resp.hookSpecificOutput
    const reason = hso?.permissionDecisionReason || e.resp.reason || ''
    const tag = `[${e.rule.name}:${e.rule.action}]`
    return reason ? `${tag} ${reason}` : tag
  }).filter(Boolean).join('\n')

  const base = _deepClone(filtered[0].resp.$toDict())
  const hso = base.hookSpecificOutput || {}

  // Determine where to put merged reasons — check what fields exist on the dict
  if ('permissionDecisionReason' in hso) {
    hso.permissionDecisionReason = reasons
  } else if (hso?.decision) {
    hso.decision = { ...hso.decision, message: reasons }
  } else {
    base.reason = reasons
  }

  if (!('permissionDecision' in hso)) {
    hso.permissionDecision = priority
  }

  base.hookSpecificOutput = hso
  return base
}

// --- Block merge (PostToolUse: continue: false) ---

function _mergeBlock(blocked) {
  const reasons = blocked.map(e => {
    const hso = e.resp.hookSpecificOutput
    const reason = hso?.reason || hso?.permissionDecisionReason || e.resp.reason || ''
    const tag = `[${e.rule.name}:${e.rule.action}]`
    return reason ? `${tag} ${reason}` : tag
  }).filter(Boolean).join('\n')

  const base = _deepClone(blocked[0].resp.$toDict())

  // PostToolUse block = { continue: false } (no permissionDecision)
  if (base.continue === false) {
    if (reasons && base.reason === undefined) {
      base.reason = reasons
    }
    return base
  }

  // Fallback to deny-like response — check dict fields directly
  const hso = base.hookSpecificOutput || {}
  hso.permissionDecision = 'deny'
  if (reasons) {
    if ('permissionDecisionReason' in hso) {
      hso.permissionDecisionReason = reasons
    } else {
      base.reason = reasons
    }
  }
  base.hookSpecificOutput = hso

  return base
}

// --- Allow merge: combine updatedInput from all allows ---

function _mergeAllow(allows) {
  const base = _deepClone(allows[0].resp.$toDict())
  if (!base.hookSpecificOutput) base.hookSpecificOutput = {}

  let merged = {}
  for (let i = 0; i < allows.length; i++) {
    const ui = allows[i].resp.hookSpecificOutput?.updatedInput
    if (ui) {
      const dict = ui.$toDict?.() || ui
      merged = { ...merged, ...dict }
    }
  }

  if (Object.keys(merged).length) {
    base.hookSpecificOutput = {
      ...base.hookSpecificOutput,
      updatedInput: {
        ...(base.hookSpecificOutput.updatedInput || {}),
        ...merged
      }
    }
  }

  return base
}

// --- Context merge: additionalContext or systemMessage ---

function _mergeContext(ctxs) {
  const parts = ctxs.map(e => {
    const hso = e.resp.hookSpecificOutput
    const ctx = hso?.additionalContext || e.resp.systemMessage || ''
    return ctx ? `[${e.rule.name}] ${ctx}` : null
  }).filter(Boolean)

  const base = _deepClone(ctxs[0].resp.$toDict())

  if (parts.length) {
    const joined = parts.join('\n\n')
    if (base.hookSpecificOutput) {
      base.hookSpecificOutput = {
        ...base.hookSpecificOutput,
        additionalContext: joined
      }
    } else {
      base.systemMessage = joined
    }
  }

  return base
}

// --- Utilities ---

function _getDecision(resp) {
  const hso = resp.hookSpecificOutput
  if (!hso) {
    return resp.continue === false ? 'block' : null
  }
  return hso.permissionDecision || hso.decision?.behavior || null
}

function _deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(v => _deepClone(v))
  if (obj instanceof Date) return new Date(obj)
  if (obj instanceof Set) return new Set(obj)
  if (obj instanceof Map) return new Map(obj)

  const clone = Object.create(Object.getPrototypeOf(obj))
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const val = obj[key]
      clone[key] = val !== null && typeof val === 'object' ? _deepClone(val) : val
    }
  }
  return clone
}
