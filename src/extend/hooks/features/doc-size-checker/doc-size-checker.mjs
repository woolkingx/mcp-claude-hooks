// doc-size-checker/doc-size-checker.mjs — Size check for documentation files
// Three levels: best (info), warn, error. Unit: "lines" or "chars".
// Claude Code MAX_MEMORY_CHARACTER_COUNT = 40000 per file (claudemd.ts:92)

import { readFileSync, existsSync } from 'node:fs'

export const name = 'doc-size-checker'

const DEFAULTS = { best: 200, warn: 300, error: 500, unit: 'lines' }

function _measure(content, unit) {
  if (unit === 'chars') return content.length
  return content.split('\n').length
}

function _readFile(filePath) {
  if (!filePath || !existsSync(filePath)) return null
  try { return readFileSync(filePath, 'utf-8') }
  catch { return null }
}

function _buildMessage(filePath, count, cfg) {
  const best  = cfg.best  ?? DEFAULTS.best
  const warn  = cfg.warn  ?? DEFAULTS.warn
  const error = cfg.error ?? DEFAULTS.error
  const unit  = cfg.unit  ?? DEFAULTS.unit
  if (count <= best) return null

  const fileName = filePath.split('/').pop()
  const display  = unit === 'chars' ? `${(count / 1000).toFixed(1)}k chars` : `${count} lines`

  let level, label, tip
  if (count >= error) {
    level = 'ERROR'
    label = `**[doc-size ${level}]** \`${fileName}\` is ${display} — exceeds ${error} ${unit} limit.`
    tip   = '\nEvery line in this file is sent with every request. Trim or split before saving.'
  } else if (count >= warn) {
    level = 'WARN'
    label = `**[doc-size ${level}]** \`${fileName}\` is ${display} — approaching ${error} ${unit} limit (warn at ${warn}).`
    tip   = '\nConsider trimming: remove explanatory text, keep only rules with concrete examples.'
  } else {
    level = 'INFO'
    label = `**[doc-size ${level}]** \`${fileName}\` is ${display} — over ${best} ${unit} best practice.`
    tip   = '\nConsider whether all content is essential. Shorter files = lower token cost per request.'
  }

  return label + tip
}

export function execute(event, config = {}) {
  const filePath = event.tool_input?.file_path
  const content  = _readFile(filePath)
  if (!content) return null
  const unit = config.unit ?? DEFAULTS.unit
  return _buildMessage(filePath, _measure(content, unit), config)
}
