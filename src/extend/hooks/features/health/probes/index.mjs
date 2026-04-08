// probes/index.mjs — Probe registry and runner
// Each probe: { name, weight, check(cwd, config) → { status, detail } }

import * as claudeMd from './claude-md.mjs'
import * as architecture from './architecture.mjs'
import * as gitState from './git-state.mjs'
import * as tests from './tests.mjs'
import * as manifest from './manifest.mjs'
import * as readme from './readme.mjs'
import * as license from './license.mjs'
import * as hooksCoverage from './hooks-coverage.mjs'
import * as envProtected from './env-protected.mjs'

const ALL_PROBES = [claudeMd, architecture, gitState, tests, hooksCoverage, readme, manifest, license, envProtected]

const _registry = new Map(ALL_PROBES.map(p => [p.name, p]))

export function runProbes(cwd, config = {}) {
  const enabled = config.checks || ALL_PROBES.map(p => p.name)
  const results = []

  for (const name of enabled) {
    const probe = _registry.get(name)
    if (!probe) continue
    try {
      const result = probe.check(cwd, config)
      results.push({ name: probe.name, weight: probe.weight, ...result })
    } catch (e) {
      results.push({ name: probe.name, weight: probe.weight, status: 'fail', detail: `Error: ${e.message}` })
    }
  }

  return results
}

export function listProbes() {
  return ALL_PROBES.map(p => p.name)
}
