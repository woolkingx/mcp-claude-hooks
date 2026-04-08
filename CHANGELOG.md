# Changelog

All notable changes to mcp-claude-hooks.

## [0.4.0] — 2026-04-08

### Fixed

- **Agent buff `[object Object]` injection** — removed duplicate `_drainAgentBuff` from UserPromptSubmit handler that joined `{ts,text,sent}` objects without `.text` extraction. Buff drain now handled entirely by inject rule → featureResult → additionalContext
- **Agent worker defaults mismatch** — worker fallback maxTurns=1/maxBudget=0.01 aligned to schema defaults (20/0.25)

### Changed

- **Agent buff storage split** — buff data moved from `agent-state.json` to per-session JSONL files (`logs/agent-buff-{sessionId}.jsonl`). Each entry has `{ts, text, sent}` fields. State file now contains session metadata only
- **Agent worker result-only buffing** — worker only buffs SDK `result` events (final output), not intermediate assistant turns. Eliminates "I'll read the transcript..." preamble noise
- **Agent maxTurns 3→20** — agent observer now has enough turns to read transcript and produce full analysis
- **Agent two-phase rule architecture** — Stop event triggers worker dispatch (`stop-agent-observer.json`, mode=trigger), UserPromptSubmit drains buff into context (`userprompt-agent-drain.json`, mode=inject). Engine has no direct agent calls
- **Agent observer prompt** — enforced bullet list output format (`- [TAG] finding`), prohibited prose paragraphs, recap, and repetition across dispatches
- **Agent worker recursion guard** — `__HOOKS_AGENT_WORKER=1` env bypasses daemon proxy; `daemonOnly` guard prevents dispatch loop

### Added

- **`userprompt-agent-drain.json` rule** — inject mode rule for UserPromptSubmit, priority 80
- **Features convenience methods** — `collectAgent`, `cleanupAgent`, `agentStatus`, `setAgentDaemonMode` on features tree
- **Buff migration** — daemon init converts old `state.buff` object to per-session JSONL files (one-time migration)
- **Sent flag crash recovery** — daemon restart resets all buff `sent` flags to false (prevents lost inject after crash)

## [0.3.1] — 2026-04-08

### Added

- **Health feature** — project health assessment with 9 probes (claude_md, architecture, git_active, tests, hooks_coverage, readme, manifest, license, env_protected). Weighted scoring with A-F grade, per-cwd JSON state with 3-snapshot history and trend tracking (improving/stable/degrading). Triggered on first UserPromptSubmit via `health-check` rule, injects warnings as context. Also available as `hooks_admin:health` MCP tool
- **health-check rule** — default rule for health feature, UserPromptSubmit + repeat:false
- 19 suites, 316 tests

## [0.3.0] — 2026-04-08

### Fixed

- **B1: Reload pipeline convergence** — all reload triggers (CLI, MCP, CRUD, SIGHUP) now converge to `hooks_admin:reload`. Orchestration logic moved from mcp.mjs to `admin.reload()`. `engine:reload` handler calls `rules.reload()` instead of no-op. `rules:changed` handler registered in `rules.setBus()` triggers full reload pipeline
- **B2: Layer dependency violation** — `hook-match.mjs` relocated to canonical L1 location (`src/lib/hook-match.mjs`). Engine re-exports via shim. L2 `rules.mjs` imports from L1
- **B3: CLI reload bypassed command pattern** — CLI reload now uses daemon socket → `tools/call hooks_admin reload` instead of direct `SIGHUP`
- **B4: CLI restart bypassed command pattern** — CLI restart uses daemon socket → `tools/call hooks_admin restart`
- **B5: Daemon SIGHUP direct reload** — removed `reloadDaemon()`. SIGHUP handler uses `bus.send('hooks_admin:reload')`
- **B6: SessionStart deny missing reason** — added `response.reason` on deny action
- **B7: PostCompact invalid hookSpecificOutput** — removed `hookSpecificOutput` assignment (PostCompact has no dedicated HSO type in schema anyOf). Uses `systemMessage` for output

### Added

- **22 dedicated event handlers** — one handler per event schema (ConfigChange, CwdChanged, Elicitation, ElicitationResult, FileChanged, InstructionsLoaded, Notification, PostCompact, PostToolUseFailure, PreCompact, SessionStart, Setup, Stop, StopFailure, SubagentStart, SubagentStop, TaskCompleted, TaskCreated, TeammateIdle, WorktreeCreate, WorktreeRemove, UserPromptSubmit rewrite)
- **Agent observer feature** — background analysis via `features/agent/` module
- **`src/lib/hook-match.mjs`** — canonical L1 location for match functions
- **Architecture docs** — `.claude/rules/` with api-surface, data-flow, debug-symptoms, hook-dataflow, pitfalls, conventions, schema-chain

### Changed

- `mcp.mjs` is now pure binding layer — no orchestration logic
- `engine:reload` handler is functional (`rules.reload()` fn call, not no-op)
- `admin.reload()` owns reload composition (`engine:reload` + `hooks_rules:reload` + runtime config)
- `rules.setBus()` registers `rules:changed → hooks_admin:reload` handler
- CLI stop/status documented as architectural exception (must work when daemon dead)
- Tests: 18 suites, 292 tests

## [0.2.0] — 2026-04-06

### Fixed

- **Zero-downtime daemon restart** — detached restart-helper subprocess orchestrates fork-new → wait-ready → stop-old. Fixes socket deletion race where `server.close()` auto-unlinks the Unix socket. Shutdown now checks pidfile ownership before cleanup.
- **Loader subLoader in engine** — event-local `$ref` resolves through the correct sub-loader, not the root loader
- **restart-helper logs to file** — helper writes ISO-timestamped entries to `run/helper.log` instead of stderr. Handler no longer manages stderr fd.

### Added

- **doc-size-checker rule** — three-level check (warn/ask/deny) with configurable `unit` parameter for file size enforcement
- **Daemon test suite** — 11 tests covering lifecycle, restart, socket readiness, ownership guard, and managed-restart env
- **Dataflow test suite** — end-to-end data flow verification through the engine pipeline
- **Log test suite** — log file rotation and format validation

### Changed

- Template generator scans feature schemas dynamically instead of hardcoded list
- All tests migrated to `node:test` with schema-validated assertions

## [0.1.1] — 2026-04-05

- Added repository, homepage, bugs, author to package.json
- Added MIT LICENSE file

## [0.1.0] — 2026-04-05

Initial public release.

### Features

- **55 built-in rules** — deny dangerous commands (rm, sudo, force-push), require confirmation (git commit, chmod), inject context (session welcome, post-compaction reload), auto-approve safe reads
- **Draft-07 schema matching** — rules ARE JSON Schemas. ObjectTree construction succeeds = match. No custom query language
- **Bash AST matching** — `match_bash` parses commands via unbash, matches each AST node independently. Compound commands (`&&`, `|`, `;`) produce multiple match targets
- **27 hook event schemas** — covers all Claude Code hook events: PreToolUse, PostToolUse, PermissionRequest, SessionStart, UserPromptSubmit, SubagentStart, and 21 more
- **Daemon mode** — Unix socket fast path. Hook events proxy through warm engine instead of cold-starting Node per call
- **MCP server** — JSON-RPC interface for rule CRUD, system admin, log inspection, analytics
- **CLI adapter** — human-readable rule management from terminal
- **Per-session dedup** — `repeat: false` fires a rule once per session. `repeat: N` adds cooldown in seconds
- **Merge policy** — multiple rules match the same event: deny > ask > allow > context
- **Template generator** — `hooks_rules template event=PreToolUse` generates a rule skeleton from the event schema
- **Pause/resume** — suspend all rules for debugging without stopping the daemon
- **Log pipeline** — every event logged with timestamp, rule match result, and action taken. Rotates daily

### Architecture

- Single entry point `main.mjs` — routes to hook, MCP, CLI, or daemon mode
- Three-layer dependency: foundation → server → adapters (reverse import = bug)
- Object module pattern: `createX(config, loader) → ObjectTree` with fn-call internals
- Root Loader shared across all modules — one schema resolution context

### Tests

- 17 test suites, 266 tests on node:test
- Unit: bash-parser, state, schema-match, schema-chain, rules-valid, template, 3-layer, rules, handlers, merger, features, engine, object-module
- Integration: hook stdin pipe, CLI adapter, daemon lifecycle + restart, log pipeline
