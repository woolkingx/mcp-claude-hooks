#!/usr/bin/env node
// tests/test-schema-match.mjs — POC: rule matching via Draft-07 schema + ObjectTree
// Rule IS a schema. Event validates against it. valid = match, invalid = no match.

import { describe, it, assert } from './helpers/context.mjs'
import { validate, ObjectTree } from '../src/lib/schema2object.mjs'
import { parse as parseBash } from '../src/lib/bash-parser.mjs'

// Helper: does event match rule schema?
function matches(ruleSchema, event) {
  return validate(event, ruleSchema).valid
}

describe('schema-match — tool_name matching', () => {
  it('tool_name == Bash → match', () => {
    const rule = {
      type: 'object',
      properties: { tool_name: { const: 'Bash' } },
      required: ['tool_name']
    }
    assert.ok(matches(rule, { tool_name: 'Bash', tool_input: { command: 'ls' } }))
  })

  it('tool_name == Bash → no match on Write', () => {
    const rule = {
      type: 'object',
      properties: { tool_name: { const: 'Bash' } },
      required: ['tool_name']
    }
    assert.ok(!matches(rule, { tool_name: 'Write', tool_input: {} }))
  })

  it('tool_name in [Bash, Write] via enum', () => {
    const rule = {
      type: 'object',
      properties: { tool_name: { enum: ['Bash', 'Write'] } },
      required: ['tool_name']
    }
    assert.ok(matches(rule, { tool_name: 'Bash', tool_input: {} }))
    assert.ok(matches(rule, { tool_name: 'Write', tool_input: {} }))
    assert.ok(!matches(rule, { tool_name: 'Read', tool_input: {} }))
  })
})

describe('schema-match — path matching', () => {
  it('file_path ext .md via pattern', () => {
    const rule = {
      type: 'object',
      properties: {
        tool_input: {
          type: 'object',
          properties: {
            file_path: { type: 'string', pattern: '\\.md$' }
          },
          required: ['file_path']
        }
      }
    }
    assert.ok(matches(rule, { tool_input: { file_path: '/docs/README.md' } }))
    assert.ok(!matches(rule, { tool_input: { file_path: '/src/main.py' } }))
  })

  it('file_path under /etc via pattern', () => {
    const rule = {
      type: 'object',
      properties: {
        tool_input: {
          type: 'object',
          properties: {
            file_path: { type: 'string', pattern: '^/etc/' }
          }
        }
      }
    }
    assert.ok(matches(rule, { tool_input: { file_path: '/etc/passwd' } }))
    assert.ok(!matches(rule, { tool_input: { file_path: '/home/user/.env' } }))
  })
})

describe('schema-match — command pattern matching', () => {
  it('command contains sudo via pattern', () => {
    const rule = {
      type: 'object',
      properties: {
        tool_name: { const: 'Bash' },
        tool_input: {
          type: 'object',
          properties: {
            command: { type: 'string', pattern: '\\bsudo\\b' }
          }
        }
      }
    }
    assert.ok(matches(rule, { tool_name: 'Bash', tool_input: { command: 'sudo apt update' } }))
    assert.ok(!matches(rule, { tool_name: 'Bash', tool_input: { command: 'ls -la' } }))
  })

  it('command contains rm via pattern', () => {
    const rule = {
      type: 'object',
      properties: {
        tool_input: {
          type: 'object',
          properties: {
            command: { type: 'string', pattern: '\\brm\\b' }
          }
        }
      }
    }
    assert.ok(matches(rule, { tool_input: { command: 'rm foo' } }))
    assert.ok(matches(rule, { tool_input: { command: 'rm -rf /tmp' } }))
    assert.ok(!matches(rule, { tool_input: { command: 'ls -la' } }))
  })
})

describe('schema-match — logic composition', () => {
  it('allOf: tool_name == Bash AND command has git', () => {
    const rule = {
      allOf: [
        { properties: { tool_name: { const: 'Bash' } }, required: ['tool_name'] },
        { properties: { tool_input: { properties: { command: { pattern: '\\bgit\\b' } } } } }
      ]
    }
    assert.ok(matches(rule, { tool_name: 'Bash', tool_input: { command: 'git status' } }))
    assert.ok(!matches(rule, { tool_name: 'Read', tool_input: { command: 'git status' } }))
    assert.ok(!matches(rule, { tool_name: 'Bash', tool_input: { command: 'ls' } }))
  })

  it('anyOf: tool_name Bash OR Write', () => {
    const rule = {
      anyOf: [
        { properties: { tool_name: { const: 'Bash' } }, required: ['tool_name'] },
        { properties: { tool_name: { const: 'Write' } }, required: ['tool_name'] }
      ]
    }
    assert.ok(matches(rule, { tool_name: 'Bash' }))
    assert.ok(matches(rule, { tool_name: 'Write' }))
    assert.ok(!matches(rule, { tool_name: 'Read' }))
  })

  it('not: NOT tool_name == Read', () => {
    const rule = {
      not: { properties: { tool_name: { const: 'Read' } }, required: ['tool_name'] }
    }
    assert.ok(matches(rule, { tool_name: 'Bash' }))
    assert.ok(!matches(rule, { tool_name: 'Read' }))
  })

  it('if/then: if Bash then command required', () => {
    const rule = {
      if: { properties: { tool_name: { const: 'Bash' } } },
      then: { properties: { tool_input: { required: ['command'] } } }
    }
    assert.ok(matches(rule, { tool_name: 'Bash', tool_input: { command: 'ls' } }))
    assert.ok(matches(rule, { tool_name: 'Read', tool_input: {} }))
  })
})

describe('schema-match — ObjectTree integration', () => {
  it('ObjectTree validate + toDict round trip', () => {
    const schema = {
      type: 'object',
      properties: {
        tool_name: { const: 'Bash' },
        tool_input: {
          type: 'object',
          properties: {
            command: { type: 'string', pattern: '\\brm\\b' }
          }
        }
      }
    }
    const event = { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }
    const result = validate(event, schema)
    assert.ok(result.valid)

    const tree = new ObjectTree(event, schema)
    assert.equal(tree.tool_name, 'Bash')
    const out = tree.$toDict()
    assert.equal(out.tool_name, 'Bash')
  })
})

describe('schema-match — unbash + Draft-07', () => {
  // Helper: parse command, validate each Command node against rule schema via ObjectTree
  function matchesBash(ruleSchema, command) {
    const parsed = parseBash(command)
    if (!parsed || parsed.type === 'error') return false
    return parsed.commands
      .filter(cmd => cmd.type === 'Command')
      .some(cmd => { try { new ObjectTree(cmd, ruleSchema); return true } catch { return false } })
  }

  it('simple rm → match cmd schema', () => {
    const rule = { properties: { name: { properties: { text: { const: 'rm' } } } }, required: ['name'] }
    assert.ok(matchesBash(rule, 'rm foo'))
  })

  it('compound: cd && rm → rm matches', () => {
    const rule = { properties: { name: { properties: { text: { const: 'rm' } } } }, required: ['name'] }
    assert.ok(matchesBash(rule, 'cd /tmp && rm -rf *'))
  })

  it('compound: cd && ls → rm not matched', () => {
    const rule = { properties: { name: { properties: { text: { const: 'rm' } } } }, required: ['name'] }
    assert.ok(!matchesBash(rule, 'cd /tmp && ls -la'))
  })

  it('sudo anywhere in compound', () => {
    const rule = { properties: { name: { properties: { text: { const: 'sudo' } } } }, required: ['name'] }
    assert.ok(matchesBash(rule, 'cd /tmp && sudo apt update'))
  })

  it('git with flag --force via suffix contains', () => {
    const rule = {
      allOf: [
        { properties: { name: { properties: { text: { const: 'git' } } } }, required: ['name'] },
        { properties: { suffix: { type: 'array', contains: { properties: { text: { const: '--force' } } } } } }
      ]
    }
    assert.ok(matchesBash(rule, 'git push --force origin main'))
    assert.ok(!matchesBash(rule, 'git push origin main'))
  })

  it('git with flag --hard', () => {
    const rule = {
      allOf: [
        { properties: { name: { properties: { text: { const: 'git' } } } }, required: ['name'] },
        { properties: { suffix: { type: 'array', contains: { properties: { text: { const: '--hard' } } } } } }
      ]
    }
    assert.ok(matchesBash(rule, 'git reset --hard HEAD'))
    assert.ok(!matchesBash(rule, 'git reset HEAD'))
  })

  it('rm with -r flag', () => {
    const rule = {
      allOf: [
        { properties: { name: { properties: { text: { const: 'rm' } } } }, required: ['name'] },
        { properties: { suffix: { type: 'array', contains: { properties: { text: { pattern: '^-[a-zA-Z]*r' } } } } } }
      ]
    }
    assert.ok(matchesBash(rule, 'rm -rf /tmp'))
    assert.ok(!matchesBash(rule, 'rm foo'))
  })

  it('any_cmd via enum on name.text', () => {
    const rule = {
      properties: { name: { properties: { text: { enum: ['rm', 'dd', 'mkfs'] } } } },
      required: ['name']
    }
    assert.ok(matchesBash(rule, 'cd /tmp && rm foo'))
    assert.ok(matchesBash(rule, 'dd if=/dev/zero of=/dev/sda'))
    assert.ok(!matchesBash(rule, 'ls -la'))
  })

  it('args pattern match via suffix contains', () => {
    const rule = {
      allOf: [
        { properties: { name: { properties: { text: { const: 'grep' } } } }, required: ['name'] },
        { properties: { suffix: { type: 'array', contains: { properties: { text: { pattern: 'TODO' } } } } } }
      ]
    }
    assert.ok(matchesBash(rule, 'grep -r TODO src/'))
    assert.ok(!matchesBash(rule, 'grep -r FIXME src/'))
  })

  it('pipe: cat | grep → grep matches', () => {
    const rule = { properties: { name: { properties: { text: { const: 'grep' } } } }, required: ['name'] }
    assert.ok(matchesBash(rule, 'cat file | grep pattern'))
  })

  it('sed in compound', () => {
    const rule = { properties: { name: { properties: { text: { const: 'sed' } } } }, required: ['name'] }
    assert.ok(matchesBash(rule, 'cd src && sed -i s/a/b/ file'))
    assert.ok(!matchesBash(rule, 'cd src && cat file'))
  })
})
