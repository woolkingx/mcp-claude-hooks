# Changelog

All notable changes to mcp-claude-hooks.

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
