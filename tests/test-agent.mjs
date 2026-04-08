#!/usr/bin/env node
// tests/test-agent.mjs — agent observer feature: public interface tests
// Tests non-SDK paths: daemon guard, buff ops, state persistence, prompt loading
// Agent is now a factory: createAgent(config, bus, loader) → ObjectTree

import { describe, it, before, after, assert, freshDir } from './helpers/context.mjs'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { createAgent } from '../src/extend/hooks/features/agent/agent.mjs'

// Helper: create agent instance with optional fake bus
function _makeAgent(bus = null) {
  return createAgent({}, bus, null)
}

describe('agent — module exports (ObjectTree)', () => {
  const agent = _makeAgent()

  it('has required interface methods', () => {
    assert.equal(typeof agent.execute, 'function')
    assert.equal(typeof agent.collect, 'function')
    assert.equal(typeof agent.cleanup, 'function')
    assert.equal(typeof agent.status, 'function')
    assert.equal(typeof agent.setDaemonMode, 'function')
  })

  it('is an ObjectTree (has $ API)', () => {
    assert.equal(typeof agent.$toDict, 'function')
    assert.equal(typeof agent.$value, 'object')
  })
})

describe('agent — daemon guard', () => {
  const agent = _makeAgent()

  it('execute returns null when not in daemon mode', () => {
    const event = { hook_event_name: 'Stop', session_id: 'test-123', transcript_path: '/tmp/fake.jsonl', cwd: '/tmp' }
    const result = agent.execute(event, {})
    assert.equal(result, null)
  })

  it('execute returns null without session_id', () => {
    agent.setDaemonMode(true)
    const event = { hook_event_name: 'Stop', cwd: '/tmp' }
    const result = agent.execute(event, {})
    assert.equal(result, null)
    agent.setDaemonMode(false)
  })
})

describe('agent — collect / cleanup / status', () => {
  const agent = _makeAgent()

  it('collect returns null for unknown session', () => {
    const result = agent.collect('nonexistent-session')
    assert.equal(result, null)
  })

  it('status returns empty object initially', () => {
    const s = agent.status()
    assert.equal(typeof s, 'object')
    assert.ok(!s['nonexistent-session'])
  })

  it('cleanup on unknown session does not throw', () => {
    assert.doesNotThrow(() => agent.cleanup('nonexistent-session'))
  })
})

describe('agent — state persistence restore', () => {
  it('setDaemonMode(false) disables daemon', () => {
    const agent = _makeAgent()
    agent.setDaemonMode(false)
    const event = { hook_event_name: 'Stop', session_id: 'test-persist-001', transcript_path: '/tmp/fake.jsonl', cwd: '/tmp' }
    const result = agent.execute(event, {})
    assert.equal(result, null, 'should return null when daemon disabled')
  })
})

describe('agent — prompt files', () => {
  it('agent.md exists and has workpoints', () => {
    const promptPath = join(new URL('../src/extend/hooks/features/agent/agent.md', import.meta.url).pathname)
    assert.ok(existsSync(promptPath), 'agent.md should exist')
    const content = readFileSync(promptPath, 'utf-8')
    assert.ok(content.includes('W1 CORRECTION'), 'should include W1')
    assert.ok(content.includes('W6 SECURITY'), 'should include W6')
    assert.ok(content.includes('## Checkpoint'), 'should include Checkpoint section')
    assert.ok(content.includes('## Workflow'), 'should include Workflow section')
  })

  it('conprompt.json exists and has templates', () => {
    const conPath = join(new URL('../src/extend/hooks/features/agent/conprompt.json', import.meta.url).pathname)
    assert.ok(existsSync(conPath), 'conprompt.json should exist')
    const raw = JSON.parse(readFileSync(conPath, 'utf-8'))
    assert.ok(raw.properties?.wakeTemplate?.const, 'should have wakeTemplate')
    assert.ok(raw.properties?.initTemplate?.const, 'should have initTemplate')
    assert.ok(raw.properties?.noTranscriptTemplate?.const, 'should have noTranscriptTemplate')
    assert.ok(raw.properties.wakeTemplate.const.includes('{transcriptPath}'), 'wakeTemplate needs {transcriptPath}')
    assert.ok(raw.properties.wakeTemplate.const.includes('{lastLine}'), 'wakeTemplate needs {lastLine}')
    assert.ok(raw.properties.wakeTemplate.const.includes('{totalLines}'), 'wakeTemplate needs {totalLines}')
  })
})

describe('agent — rule file', () => {
  it('stop-agent-observer.json is valid', () => {
    const rulePath = join(new URL('../rules/stop-agent-observer.json', import.meta.url).pathname)
    assert.ok(existsSync(rulePath), 'rule file should exist')
    const rule = JSON.parse(readFileSync(rulePath, 'utf-8'))
    assert.equal(rule.name, 'stop-agent-observer')
    assert.equal(rule.event, 'Stop')
    assert.equal(rule.feature.name, 'agent')
    assert.equal(rule.feature.config.mode, 'trigger')
    assert.equal(rule.action, 'context')
    assert.equal(rule.repeat, true)
    assert.equal(rule.enabled, true, 'agent feature enabled — loop guard verified')
  })
})

describe('agent — bus logging', () => {
  it('logs go through bus.send when bus provided', () => {
    const logs = []
    const fakeBus = {
      send(event, payload) { logs.push({ event, ...payload }); return Promise.resolve() }
    }
    const agent = _makeAgent(fakeBus)
    // Trigger a log via execute (non-daemon → skip log)
    agent.execute({ hook_event_name: 'Stop', session_id: 'bus-test-1', cwd: '/tmp' }, {})
    assert.ok(logs.length > 0, 'should have bus log entries')
    assert.ok(logs.some(l => l.event.startsWith('agent:')), 'log event should have agent: prefix')
    assert.ok(logs.every(l => l.ts && l.level && l.message), 'each log should have ts, level, message')
  })
})

describe('agent — features integration', () => {
  it('agent registered in createFeatures', async () => {
    const { createFeatures } = await import('../src/extend/hooks/features/features.mjs')
    const features = createFeatures({}, null, null)
    const list = features.list()
    assert.ok(list.includes('agent'), `agent should be in feature list: ${list}`)
  })

  it('collectAgent / cleanupAgent / agentStatus exposed', async () => {
    const { createFeatures } = await import('../src/extend/hooks/features/features.mjs')
    const features = createFeatures({}, null, null)
    assert.equal(typeof features.collectAgent, 'function')
    assert.equal(typeof features.cleanupAgent, 'function')
    assert.equal(typeof features.agentStatus, 'function')
    assert.equal(typeof features.setAgentDaemonMode, 'function')
  })

  it('createFeatures with bus passes bus to agent', async () => {
    const logs = []
    const fakeBus = {
      send(event, payload) { logs.push({ event, ...payload }); return Promise.resolve() },
      handle() {}, unhandle() {}
    }
    const { createFeatures } = await import('../src/extend/hooks/features/features.mjs')
    createFeatures({}, fakeBus, null)
    // Agent factory logs createAgent:done via bus
    assert.ok(logs.some(l => l.message?.includes('createAgent')), 'should log createAgent via bus')
  })
})
