# mcp-claude-hooks

A programmable safety layer for Claude Code. Define rules in JSON, and every tool call, permission request, and session event passes through your rules before Claude acts.

## What It Does

Claude Code fires [hook events](https://docs.anthropic.com/en/docs/claude-code/hooks) at key moments — before running a command, after editing a file, when a session starts. **mcp-claude-hooks** intercepts these events and applies your rules:

- **Block dangerous commands** — `rm -rf`, `sudo`, force-push to main, `git reset --hard`
- **Require confirmation** — `git commit`, `chmod`, config file edits
- **Inject context** — remind Claude of project conventions on session start, after compaction, or when subagents launch
- **Auto-approve safe operations** — reading docs, writing to `.claude/` directory
- **Audit everything** — every event logged with timestamp, rule match, and action taken

All rules are JSON files. No code to write. Drop a file in `rules/`, and it takes effect immediately.

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

## Daemon Mode

For faster response times, run as a background daemon. Hook events connect via Unix socket instead of cold-starting Node on every call:

```bash
# Start daemon
node src/main.mjs start --daemon

# Check status
node src/main.mjs status

# Reload rules without restart
node src/main.mjs reload

# Stop
node src/main.mjs stop
```

When the daemon is running, the hook command auto-detects the socket and proxies through it. No config change needed.

## MCP Server

Also works as an [MCP server](https://modelcontextprotocol.io/) for managing rules programmatically:

```bash
# List rules
node src/main.mjs cli hooks_rules list

# Create a rule
node src/main.mjs cli hooks_rules create name=my-rule event=PreToolUse action=deny ...

# Toggle a rule
node src/main.mjs cli hooks_rules toggle name=deny-rm enabled=false

# Test a rule against a mock event
node src/main.mjs cli hooks_rules test name=deny-rm

# System status
node src/main.mjs cli hooks_admin status

# View logs
node src/main.mjs cli hooks_admin logs
```

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
# All tests (17 suites, 266 tests)
npm test

# Unit tests only
npm run test:unit

# Integration tests (requires daemon)
npm run test:integration

# Individual suite
node --test tests/test-engine.mjs
```

## Requirements

- Node.js >= 20
- Zero external dependencies (bash parser is built-in)

## License

MIT
