// lint/lint.mjs — Syntax check by file extension
// Returns error string or null.

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'

export const name = 'lint'

const LINTERS = {
  '.py':   ['python3', '-m', 'py_compile', '$FILE'],
  '.pyi':  ['python3', '-m', 'py_compile', '$FILE'],
  '.js':   ['node', '--check', '$FILE'],
  '.mjs':  ['node', '--check', '$FILE'],
  '.cjs':  ['node', '--check', '$FILE'],
  '.ts':   ['npx', 'tsc', '--noEmit', '$FILE'],
  '.tsx':  ['npx', 'tsc', '--noEmit', '$FILE'],
  '.rs':   ['cargo', 'check', '--message-format=short'],
  '.go':   ['go', 'build', '-o', '/dev/null', '$FILE'],
  '.c':    ['gcc', '-fsyntax-only', '-Wall', '$FILE'],
  '.cpp':  ['g++', '-fsyntax-only', '-Wall', '-std=c++17', '$FILE'],
  '.sh':   ['bash', '-n', '$FILE'],
  '.rb':   ['ruby', '-c', '$FILE'],
  '.php':  ['php', '-l', '$FILE'],
}

const NAMES = {
  '.py': 'Python', '.pyi': 'Python',
  '.js': 'Node.js', '.mjs': 'Node.js', '.cjs': 'Node.js',
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.rs': 'Rust', '.go': 'Go',
  '.c': 'GCC', '.cpp': 'G++',
  '.sh': 'Bash', '.rb': 'Ruby', '.php': 'PHP',
}

function _findCargoRoot(filePath) {
  let dir = resolve(filePath, '..')
  let root = null
  while (dir !== resolve(dir, '..')) {
    if (existsSync(resolve(dir, 'Cargo.toml'))) root = dir
    dir = resolve(dir, '..')
  }
  return root
}

function _lintFile(filePath) {
  if (!filePath || !existsSync(filePath)) return null
  const ext = extname(filePath)

  if (ext === '.json') {
    try { JSON.parse(readFileSync(filePath, 'utf-8')); return null }
    catch (e) { return `**JSON error in ${filePath}:**\n\`\`\`\n${e.message}\n\`\`\`` }
  }

  const template = LINTERS[ext]
  if (!template) return null

  const args = template.map(a => a === '$FILE' ? filePath : a)
  const cmd  = args.join(' ')
  let cwd    = undefined

  if (ext === '.rs') {
    cwd = _findCargoRoot(filePath)
    if (!cwd) return null
  }

  try {
    execSync(cmd, { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'], cwd })
    return null
  } catch (e) {
    const output = (e.stderr || e.stdout || '').trim()
    if (!output) return null
    return `**${NAMES[ext] || 'Linter'} errors in ${filePath}:**\n\`\`\`\n${output}\n\`\`\``
  }
}

export function execute(event, _config) {
  try { return _lintFile(event.tool_input?.file_path) }
  catch (e) { return `**Lint error:**\n\`\`\`\n${e.message}\n\`\`\`` }
}
