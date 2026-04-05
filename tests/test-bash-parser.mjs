#!/usr/bin/env node
// tests/test-bash-parser.mjs — bash parser unit tests

import { describe, it, assert } from './helpers/context.mjs'
import { parse } from '../src/lib/bash-parser.mjs'

const cmd0 = r => r.commands[0]
const suffixValues = r => (cmd0(r)?.suffix ?? []).map(s => s.text)

describe('bash-parser', () => {
  it('simple command — name.text', () => {
    const r = parse('ls -la')
    assert.equal(cmd0(r).type, 'Command')
    assert.equal(cmd0(r).name.text, 'ls')
  })

  it('flags in suffix', () => {
    const r = parse('ls -la')
    assert.ok(suffixValues(r).includes('-la'))
  })

  it('command with args in suffix', () => {
    const r = parse('cp src.txt dst.txt')
    assert.equal(cmd0(r).name.text, 'cp')
    assert.deepEqual(suffixValues(r), ['src.txt', 'dst.txt'])
  })

  it('compound && — two Command nodes', () => {
    const r = parse('cd /tmp && git status')
    assert.equal(r.commands.length, 2)
    assert.equal(r.commands[0].name.text, 'cd')
    assert.equal(r.commands[1].name.text, 'git')
  })

  it('pipe — two Command nodes', () => {
    const r = parse('ls | wc -l')
    assert.equal(r.commands.length, 2)
    assert.equal(r.commands[0].name.text, 'ls')
    assert.equal(r.commands[1].name.text, 'wc')
  })

  it('git subcommand in suffix', () => {
    const r = parse('git push --force origin main')
    assert.equal(cmd0(r).name.text, 'git')
    assert.ok(suffixValues(r).includes('push'))
    assert.ok(suffixValues(r).includes('--force'))
    assert.ok(suffixValues(r).includes('main'))
  })

  it('combined flags -rf in suffix', () => {
    const r = parse('rm -rf /tmp/foo')
    assert.equal(cmd0(r).name.text, 'rm')
    assert.ok(suffixValues(r).some(v => /^-[a-zA-Z]*r/.test(v)))
    assert.ok(suffixValues(r).some(v => /^-[a-zA-Z]*f/.test(v)))
  })

  it('redirect operator in redirects', () => {
    const r = parse('echo hello > out.txt')
    assert.equal(cmd0(r).name.text, 'echo')
    assert.ok(cmd0(r).redirects.some(rd => rd.operator === '>'))
  })

  it('empty command — no commands', () => {
    const r = parse('')
    assert.deepEqual(r.commands, [])
  })

  it('semicolon separator — two Command nodes', () => {
    const r = parse('echo a; echo b')
    assert.equal(r.commands.length, 2)
    assert.equal(r.commands[0].name.text, 'echo')
    assert.equal(r.commands[1].name.text, 'echo')
  })

  it('|| operator — two Command nodes', () => {
    const r = parse('test -f foo || echo missing')
    assert.equal(r.commands.length, 2)
  })
})
