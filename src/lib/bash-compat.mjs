/**
 * Compatibility layer: bashjsast AST → unbash-compatible Command shape
 * Drop-in replacement for unbash in mcp-claude-hooks bash-parser.mjs
 *
 * unbash Command shape:
 *   { type: 'Command', name: {text}, prefix: [{text}], suffix: [{text}], redirects: [{operator, content}] }
 *
 * prefix = assignments before command name
 * suffix = args after command name (flags + positional)
 * redirects = redirect ops with target
 */

import { parse as bashjsParse } from './bash-ast-parser.mjs'

export function parse(command) {
  if (!command || typeof command !== 'string') return emptyResult()
  command = command.trim()
  if (!command) return emptyResult()

  try {
    const ast = bashjsParse(command)
    const commands = []
    flattenNode(ast, commands)
    return { type: 'simple', commands, raw: command }
  } catch {
    return { type: 'error', commands: [], raw: command }
  }
}

function flattenNode(node, commands) {
  if (!node) return
  switch (node.type) {
    case 'Script':
      node.commands?.forEach(c => flattenNode(c, commands)); break
    case 'SimpleCommand':
      commands.push(toCommand(node)); break
    case 'Pipeline':
      node.commands?.forEach(c => flattenNode(c, commands)); break
    case 'List':
      flattenNode(node.left, commands); flattenNode(node.right, commands); break
    case 'If':
      flattenNode(node.test, commands); flattenNode(node.body, commands)
      flattenNode(node.alternate, commands); break
    case 'While': case 'Until':
      flattenNode(node.test, commands); flattenNode(node.body, commands); break
    case 'For': case 'Select':
      flattenNode(node.body, commands); break
    case 'Case':
      node.clauses?.forEach(c => flattenNode(c.body, commands)); break
    case 'Group': case 'Subshell':
      flattenNode(node.body, commands); break
    case 'Function':
      flattenNode(node.body, commands); break
    case 'Coproc':
      flattenNode(node.body, commands); break
    case 'Arithmetic':
      // (( expr )) — represent as command with name "(("
      commands.push({
        type: 'Command',
        name: { text: '((' },
        prefix: [],
        suffix: [{ text: node.expression.text }, { text: '))' }],
        redirects: toRedirects(node.redirects)
      }); break
    case 'Condition':
      // [[ expr ]] — represent as command with name "[["
      commands.push({
        type: 'Command',
        name: { text: '[[' },
        prefix: [],
        suffix: [...conditionWords(node), { text: ']]' }],
        redirects: []
      }); break
  }
}

function toCommand(node) {
  const prefix = (node.assignments || []).map(a => {
    const op = a.append ? '+=' : '='
    const rhs = a.rhs?.text ?? ''
    return { text: `${a.name}${op}${rhs}` }
  })

  const suffix = (node.args || []).map(a => ({ text: a.text }))

  const cmd = { type: 'Command', prefix, suffix, redirects: toRedirects(node.redirects) }
  if (node.name) cmd.name = { text: node.name.text }
  return cmd
}

function toRedirects(redirects) {
  if (!redirects?.length) return []
  return redirects.map(r => ({
    operator: r.op,
    content: r.target?.text ?? ''
  }))
}

function conditionWords(node) {
  if (!node) return []
  switch (node.condType) {
    case 'and':
      return [...conditionWords(node.left), { text: '&&' }, ...conditionWords(node.right)]
    case 'or':
      return [...conditionWords(node.left), { text: '||' }, ...conditionWords(node.right)]
    case 'unary':
      return [{ text: node.op.text }, ...conditionWords(node.left)]
    case 'binary':
      return [...conditionWords(node.left), { text: node.op.text }, ...conditionWords(node.right)]
    case 'term':
      return [{ text: node.op.text }]
    case 'expr':
      return [{ text: '(' }, ...conditionWords(node.left), { text: ')' }]
    default:
      return node.op ? [{ text: node.op.text }] : []
  }
}

function emptyResult() {
  return { type: 'simple', commands: [], raw: '' }
}
