# mcp-claude-hooks

A programmable safety layer for [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks). Define rules in JSON — no code to write.

## Why

Claude Code in autonomous mode is powerful, but one wrong `rm -rf` or `git push --force` can ruin your day. The built-in hook system lets you run a command on each event, but writing and maintaining individual shell scripts for every safety check doesn't scale.

**mcp-claude-hooks** gives you a rule engine that sits between Claude and your system. You describe _what to block, allow, or modify_ in JSON, and the engine handles matching, deduplication, and response merging for you.

## Features

| Feature | What it does for you |
|---------|---------------------|
| **Safety guardrails** | Block destructive commands (`rm -rf`, `sudo`, force-push, `git reset --hard`) before they execute. Run autonomous mode without babysitting. |
| **Smart auto-approve** | Auto-approve operations you trust (reading docs, writing to safe dirs) so you stop clicking "Allow" dozens of times per session. |
| **Context injection** | Re-inject project conventions after compaction, on session start, when subagents launch. Claude stays on track without you repeating yourself. |
| **Bash AST matching** | Match against parsed command AST, not string patterns. `rm -rf /` inside `mkdir foo && rm -rf /` is caught; `echo "remove"` is not. |
| **Live rule management** | Create, toggle, test, and delete rules via MCP tools or CLI — no restart, no config edit, no leaving your session. |
| **Observability** | System status, per-rule analytics (match count, deny rate, latency), and full event logs — see what Claude tried and why it was blocked. |
| **Pause / resume** | One command to disable all rules (pass-through mode) for debugging, one to re-enable. |
| **Hot reload** | Edit rule JSON files on disk, reload without restarting. Daemon mode keeps state across reloads. |
| **Daemon mode** | Background process with Unix socket — lower latency, shared dedup state, survives across hook invocations. |
| **Test mode** | Set any rule to `"test"` — it matches and logs but takes no action. Validate before you enforce. |
| **Deduplication** | Context rules fire once per session by default. No repeated token waste from the same reminder. |
| **27 hook events** | Covers the full Claude Code lifecycle — tool use, permissions, sessions, subagents, compaction, worktrees, tasks, elicitation. |
| **55 included rules** | Ships with a battle-tested rule set. Edit, disable, or delete any of them. Add your own. |
| **Zero dependencies** | Node.js only. Bash parser is built-in. Nothing to install beyond `npm install`. |

## Quick Start

```bash
git clone <repo-url> mcp-claude-hooks
cd mcp-claude-hooks
npm install
```

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{ "command": "node /path/to/mcp-claude-hooks/src/main.mjs" }],
    "PostToolUse": [{ "command": "node /path/to/mcp-claude-hooks/src/main.mjs" }],
    "PermissionRequest": [{ "command": "node /path/to/mcp-claude-hooks/src/main.mjs" }],
    "SessionStart": [{ "command": "node /path/to/mcp-claude-hooks/src/main.mjs" }],
    "SessionEnd": [{ "command": "node /path/to/mcp-claude-hooks/src/main.mjs" }],
    "UserPromptSubmit": [{ "command": "node /path/to/mcp-claude-hooks/src/main.mjs" }],
    "SubagentStart": [{ "command": "node /path/to/mcp-claude-hooks/src/main.mjs" }],
    "PostCompact": [{ "command": "node /path/to/mcp-claude-hooks/src/main.mjs" }]
  }
}
```

Verify it works:

```bash
echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"rm foo"}}' | node src/main.mjs
# → {"continue":false,"hookSpecificOutput":{"permissionDecision":"deny","reason":"..."}}
```

## Writing Rules

A rule is a JSON file in `rules/`. Example — block all `rm` commands:

```json
{
  "name": "deny-rm",
  "event": "PreToolUse",
  "priority": 50,
  "enabled": true,
  "tool": "Bash",
  "match_bash": {
    "properties": { "name": { "properties": { "text": { "const": "rm" } } } },
    "required": ["name"]
  },
  "action": "deny",
  "reason": "Use mv to .cleanup/ instead of rm"
}
```

### Rule Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Unique ID, must match filename (without `.json`) |
| `event` | yes | Hook event to match (PreToolUse, SessionStart, etc.) |
| `action` | yes | What to do: deny, allow, ask, context, transform, ... |
| `enabled` | yes | `true`, `false`, or `"test"` (match + log, no action) |
| `priority` | no | 0–100, lower runs first. Default: 50 |
| `tool` | no | Filter by tool name (`"Bash"` or `["Bash", "Write"]`) |
| `cwd` | no | Filter by working directory (string or array of patterns) |
| `match` | no | JSON Schema Draft-07 matched against the event object |
| `match_bash` | no | JSON Schema matched against parsed bash AST nodes |
| `reason` | no | Message shown to Claude or the user |
| `repeat` | no | `true` (always), `false` (once per session), or seconds cooldown |

### Actions

| Action | Effect |
|--------|--------|
| **deny** | Block the operation. Claude sees the reason and must find another way |
| **allow** | Explicitly permit (overrides lower-priority rules) |
| **ask** | Let the user decide — Claude pauses for confirmation |
| **context** | Allow + inject text into Claude's context (project conventions, reminders) |
| **transform** | Allow + modify the tool input before execution |

### Match Strategies

**`match`** — JSON Schema against the raw event:
```json
{ "match": { "properties": { "tool_name": { "const": "Bash" } } } }
```

**`match_bash`** — JSON Schema against parsed command AST nodes:
```json
{
  "match_bash": {
    "properties": {
      "name": { "properties": { "text": { "const": "sudo" } } }
    },
    "required": ["name"]
  }
}
```

Bash commands are parsed into AST nodes — compound commands (`&&`, `|`, `;`) produce multiple nodes, each matched independently. A `sudo apt install foo && rm -rf /` triggers both a sudo rule and an rm rule.

**No match field** — rule matches every event of its type (useful for session-level context injection).

## Included Rules

Ships with 55 rules covering common safety patterns:

| Category | Examples | Count |
|----------|----------|-------|
| Block dangerous commands | rm, sudo, sed/awk, force-push, git reset --hard, git clean | 18 |
| Require confirmation | git commit, chmod, config edits, rsync --delete | 6 |
| Context injection | Session welcome, post-compaction reload, subagent context, coding style hints | 27 |
| Auto-approve | Read docs, write to .claude/ directory | 3 |

All rules are in `rules/`. Edit, disable, or delete any of them. Add your own.

## Management & Operations

**CLI** — manage from your terminal:

```bash
# Rules
node src/main.mjs cli hooks_rules list
node src/main.mjs cli hooks_rules toggle name=deny-rm enabled=false
node src/main.mjs cli hooks_rules test name=deny-rm
node src/main.mjs cli hooks_rules create name=my-rule event=PreToolUse action=deny ...

# Status & logs
node src/main.mjs cli hooks_admin status
node src/main.mjs cli hooks_admin logs
node src/main.mjs cli hooks_admin analytics

# Operational
node src/main.mjs cli hooks_admin pause
node src/main.mjs cli hooks_admin resume
node src/main.mjs cli hooks_admin reload
```

**MCP server** — add to `~/.claude.json` and Claude can manage rules, check status, and help author new rules interactively.

**Daemon** — background process for lower latency and shared state:

```bash
node src/main.mjs start --daemon   # start
node src/main.mjs status           # check
node src/main.mjs restart          # zero-downtime restart (new daemon ready before old stops)
node src/main.mjs stop             # stop
```

Auto-detected by the hook command. No config change needed. Restart uses a detached helper process — the new daemon is fully listening before the old one receives SIGTERM.

## Supported Events

All 27 Claude Code hook events are supported:

| Event | When It Fires |
|-------|---------------|
| **PreToolUse** | Before Claude runs a tool (Bash, Read, Write, Edit, ...) |
| **PostToolUse** | After a tool completes successfully |
| **PostToolUseFailure** | After a tool fails |
| **PermissionRequest** | When Claude asks the user for permission |
| **UserPromptSubmit** | When the user sends a message |
| **SessionStart** | Session begins |
| **SessionEnd** | Session ends |
| **SubagentStart/Stop** | Subagent lifecycle |
| **PreCompact/PostCompact** | Before/after context compaction |
| **Setup/Stop** | Process lifecycle |
| **Notification** | System notifications |
| **InstructionsLoaded** | When CLAUDE.md or instructions change |
| **ConfigChange** | When configuration changes |
| **TaskCreated/TaskCompleted** | Task lifecycle |
| **TeammateIdle** | Multi-agent coordination |
| **WorktreeCreate/Remove** | Git worktree lifecycle |
| **Elicitation/ElicitationResult** | When Claude asks the user questions |
| **StopFailure** | When session stop fails |
| **CwdChanged/FileChanged** | Directory and file change events |

## Testing

```bash
# All tests (18 suites, 282 tests)
npm test

# Unit tests only
npm run test:unit

# Integration tests (daemon lifecycle, restart, log rotation)
npm run test:integration

# Individual suite
node --test tests/test-engine.mjs
```

## Requirements

- Node.js >= 20
- Zero external dependencies (bash parser is built-in)

## License

MIT
