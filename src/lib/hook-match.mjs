// hook-match.mjs — Draft-07 schema matching for rules (core lib utility)
// Log prefix: match:validate, match:bash, match:none

import { validate } from './schema2object.mjs'
import { matchCommand } from './bash-parser.mjs'

function _noop() {}

export function matchesSchema(rule, event, log) {
  const _log = log || _noop
  const data = event?.$value ?? event

  if (rule.match_bash) {
    const cmd = data.tool_input?.command
    const result = matchCommand(cmd, rule.match_bash)
    _log('debug', `match_bash rule=${rule.name} cmd=${(cmd || '').slice(0, 80)} result=${result}`)
    return result
  }

  if (rule.match) {
    const result = validate(data, rule.match)
    _log('debug', `match rule=${rule.name} valid=${result.valid}${result.error ? ' error=' + String(result.error).slice(0, 200) : ''}`, { match_schema: rule.match, data_keys: Object.keys(data || {}) })
    return result.valid
  }

  _log('debug', `match rule=${rule.name} no-match-field (always true)`)
  return true
}
