// doc-size-checker/doc-size-checker.mjs — Word count check for documentation files
// Returns additionalContext warning or null.

import { readFileSync, existsSync } from 'node:fs'

export const name = 'doc-size-checker'

const DEFAULTS = { warn: 300, error: 500 }

function _wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function _readFile(filePath) {
  if (!filePath || !existsSync(filePath)) return null
  try { return readFileSync(filePath, 'utf-8') }
  catch { return null }
}

function _buildMessage(filePath, count, cfg) {
  const warn  = cfg.warn  ?? DEFAULTS.warn
  const error = cfg.error ?? DEFAULTS.error
  if (count < warn) return null

  const fileName = filePath.split('/').pop()
  const isError  = count >= error
  const level    = isError ? 'ERROR' : 'WARN'
  const label    = isError
    ? `**[doc-size ${level}]** \`${fileName}\` is ${count} words — exceeds ${error} word limit.`
    : `**[doc-size ${level}]** \`${fileName}\` is ${count} words — approaching ${error} word limit (warn at ${warn}).`
  const tip = isError
    ? '\nToken cost: every word in this file is sent with every request. Discuss trimming with the user before saving.'
    : '\nConsider trimming: remove explanatory text, keep only rules with ✅/❌ examples.'

  return label + tip
}

export function execute(event, config = {}) {
  const filePath = event.tool_input?.file_path
  const content  = _readFile(filePath)
  if (!content) return null
  return _buildMessage(filePath, _wordCount(content), config)
}
