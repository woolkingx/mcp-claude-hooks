// output.mjs — Centralized output formatting: json, md, file.
// All config from runtime.schema.json OutputConfig.

import { json2md } from './json2md.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Format result data according to OutputConfig.
 * @param {*} data - Raw result from handler
 * @param {string} format - 'json' | 'md' | 'file' (per-request override)
 * @param {object} outputConfig - From runtime.schema.json OutputConfig
 * @param {object} meta - { category, action } for file naming
 * @returns {{ data: string|*, filePath?: string }}
 */
export function formatOutput(data, format, outputConfig, meta = {}) {
  const fmt = format || outputConfig.format || 'md'

  if (fmt === 'json') {
    return { data }
  }

  if (fmt === 'md') {
    return { data: json2md(data, 0, outputConfig) }
  }

  if (fmt === 'file') {
    return writeToFile(data, outputConfig, meta)
  }

  // Fallback
  return { data }
}

function writeToFile(data, config, meta) {
  const dir = resolve(config.fileDir || './output')
  mkdirSync(dir, { recursive: true })

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const name = (config.fileNamePattern || '{category}_{action}_{ts}')
    .replace('{category}', meta.category || 'unknown')
    .replace('{action}', meta.action || 'unknown')
    .replace('{ts}', ts)
    .replace('{id}', meta.id || '0')

  const fileFormat = config.fileFormat || 'json'
  const ext = fileFormat === 'md' ? '.md' : '.json'
  const filePath = join(dir, name + ext)

  let content
  if (fileFormat === 'md') {
    content = json2md(data, 0, config)
  } else {
    content = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  }

  writeFileSync(filePath, content, 'utf-8')

  return {
    data: { saved: filePath, format: fileFormat, size: Buffer.byteLength(content) },
    filePath
  }
}
