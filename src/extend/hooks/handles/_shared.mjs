// _shared.mjs — Shared helper functions for event handlers
// Used by multiple handlers to resolve messages and apply transforms
// NO BUS DEPENDENCY — receives features ref via injection

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

export function _resolveMessage(rule, event, featureResult, log) {
  if (featureResult && typeof featureResult === 'string') {
    log('debug', `Feature result: ${rule.feature} len=${featureResult.length}`)
    return featureResult
  }
  if (rule.action === 'load') {
    const loaded = _loadFiles(rule.loaders, log)
    if (loaded) return loaded
  }
  return rule.reason || null
}

export function _resolveUpdatedInput(rule, event, featureResult, log) {
  if (featureResult && typeof featureResult === 'object') {
    log('debug', `Feature updatedInput: ${rule.feature} keys=${Object.keys(featureResult).join(',')}`)
    return featureResult
  }
  return _applyTransform(rule, event, log)
}

function _loadFiles(loaders, log) {
  if (!Array.isArray(loaders) || !loaders.length) return null
  const sections = []
  for (const loader of loaders) {
    const label = loader.label || loader.path || '?'
    if (loader.enable === false) {
      log('debug', `Loader skipped (disabled): ${label}`)
      continue
    }
    if (loader.type && loader.type !== 'file') {
      log('debug', `Loader skipped (not file type): ${label} type=${loader.type}`)
      continue
    }
    // Path traversal fix: validate resolved path stays within home
    let p = loader.path
    if (!p) {
      log('debug', `Loader skipped (no path): ${label}`)
      continue
    }
    if (p.startsWith('~')) {
      p = resolve(homedir(), p.slice(1))
    } else {
      p = resolve(p)
    }
    const homeDir = resolve(homedir())
    if (!p.startsWith(homeDir)) {
      log('warn', `Loader blocked (path traversal): ${label} resolved=${p}`)
      continue
    }
    if (!existsSync(p)) {
      log('debug', `Loader not found: ${label}`)
      continue
    }
    try {
      const content = readFileSync(p, 'utf-8')
      log('debug', `Loader loaded: ${label} size=${content.length}`)
      sections.push(`## ${label}\n\n${content}`)
    } catch (e) {
      log('debug', `Loader error: ${label} ${e.message}`)
    }
  }
  return sections.length ? sections.join('\n\n') : null
}

function _applyTransform(rule, event, log) {
  const t = rule.transform || rule.updatedInput
  if (!t) return null
  const field = t.field || 'command'
  const { pattern, replace } = t
  if (!pattern || replace == null) return null
  const original = event.tool_input?.[field]
  if (typeof original !== 'string') return null

  // ReDoS prevention: limit pattern length and validate no nested quantifiers
  if (typeof pattern !== 'string' || pattern.length > 200) {
    log('warn', `Transform blocked: pattern too long (${pattern.length} > 200)`)
    return null
  }
  if (/([\*\+\{])[\*\+\{]/.test(pattern)) {
    log('warn', `Transform blocked: nested quantifiers detected in pattern`)
    return null
  }

  try {
    const flags = t.flags || 'g'
    log('debug', `Transform: field=${field} pattern=${pattern}`)
    const modified = original.replace(new RegExp(pattern, flags), replace)
    if (modified === original) {
      log('debug', `Transform no-op: pattern did not match`)
      return null
    }
    log('info', `Transform: ${original} → ${modified}`)
    return { ...event.tool_input, [field]: modified }
  } catch (e) {
    log('debug', `Transform error: ${e.message}`)
    return null
  }
}
