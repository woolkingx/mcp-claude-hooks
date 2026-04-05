// log-file.mjs — minimal shared primitive for text log append
// Zero dependencies. Used by main.mjs (pre-bus) and server/log.mjs (post-bus).
// Fixed filename: hook.log. Rotation renames to hook.YYYY-MM-DD.log.

import { appendFileSync, mkdirSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const LOG_FILENAME = 'hook.log'

export function todayTag() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Rotate hook.log → hook.YYYY-MM-DD.log if date changed. Returns current log path. */
export function rotateIfNeeded(logDir, lastDay) {
  const today = todayTag()
  if (lastDay && lastDay !== today && existsSync(join(logDir, LOG_FILENAME))) {
    try {
      renameSync(join(logDir, LOG_FILENAME), join(logDir, `hook.${lastDay}.log`))
    } catch (e) {
      try { process.stderr.write(`[log-rotate-err] ${e.message}\n`) } catch {}
    }
  }
  return today
}

/** Append one line to logs/hook.log. Creates logDir if needed. */
export function appendTextLog(logDir, level, source, msg) {
  if (!logDir) return
  try {
    mkdirSync(logDir, { recursive: true })
    const ts  = new Date().toISOString()
    const lvl = level.toUpperCase().padEnd(5)
    appendFileSync(join(logDir, LOG_FILENAME), `${ts} ${lvl} ${source} ${msg}\n`)
  } catch (e) {
    try { process.stderr.write(`[log-file-err] ${source} ${e.message}\n`) } catch {}
  }
}
