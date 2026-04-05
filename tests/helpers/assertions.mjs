// tests/helpers/assertions.mjs — domain-specific assertions
import { strict as assert } from 'node:assert'

export function assertDeny(resp) {
  assert.equal(resp.hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(resp.continue, false)
}

export function assertAllow(resp) {
  assert.equal(resp.hookSpecificOutput.permissionDecision, 'allow')
  assert.equal(resp.continue, true)
}

export function assertAsk(resp) {
  assert.equal(resp.hookSpecificOutput.permissionDecision, 'ask')
  assert.equal(resp.continue, true)
}

export function assertContext(resp, field = 'additionalContext') {
  assert.equal(resp.continue, true)
  assert.ok(resp.hookSpecificOutput?.[field] || resp.systemMessage,
    `expected context in ${field} or systemMessage`)
}
