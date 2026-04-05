// stdio transport — stdin/stdout JSON-RPC adapter

import { createInterface } from 'node:readline'

export function startStdio(core, transportConfig, errorCodes) {
  const { bus } = core
  const rl = createInterface({ input: process.stdin })

  bus.send('log', { level: 'info', event: 'transport:started', message: 'stdio ready' }).catch(() => {})

  rl.on('line', async (line) => {
    if (!line.trim()) return
    let message
    try { message = JSON.parse(line) }
    catch {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: null,
        error: { code: errorCodes.PARSE_ERROR, message: 'Parse error' }
      }) + '\n')
      return
    }
    try {
      const response = await core.handle(message)
      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n')
      }
    } catch (err) {
      bus.send('log', { level: 'error', event: 'stdio', message: err.message, error: err.message, stack: err.stack }).catch(() => {})
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: message?.id ?? null,
        error: { code: errorCodes.INTERNAL_ERROR, message: 'Internal error' }
      }) + '\n')
    }
  })

  rl.on('close', () => {
    bus.send('log', { level: 'info', event: 'transport:disconnected', message: 'stdin closed' }).catch(() => {})
  })

  // Signal handling owned by core/lifecycle.mjs
}
