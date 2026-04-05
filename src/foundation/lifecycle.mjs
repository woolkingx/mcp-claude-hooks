// Lifecycle: init → ready → draining → stopped
// All config from runtime.schema.json LifecycleConfig.

export function createLifecycle(lifecycleConfig, onShutdown, bus = null) {
  const { signals, drainMs, exitCode, exitOnUncaught } = lifecycleConfig
  let state = 'init'
  const startedAt = Date.now()

  function log(level, event, message, extra = {}) {
    if (bus) {
      bus.send('log', { level, event, message, ts: Date.now(), ...extra }).catch(() => {})
    } else {
      try { process.stderr.write(`[${level}] ${event} ${message}\n`) } catch {}
    }
  }

  function ready() {
    state = 'ready'
  }

  async function shutdown() {
    if (state === 'draining' || state === 'stopped') return
    state = 'draining'
    log('info', 'lifecycle:draining', `draining (${drainMs}ms)...`)

    const timer = setTimeout(() => {
      log('warn', 'lifecycle:timeout', 'drain timeout, force exit')
      process.exit(exitCode)
    }, drainMs)

    try {
      await onShutdown()
    } catch (err) {
      log('error', 'lifecycle:shutdown-error', err.message, { error: err.message, stack: err.stack })
    } finally {
      clearTimeout(timer)
      state = 'stopped'
      process.exit(exitCode)
    }
  }

  const signalHandlers = new Map()
  for (const sig of signals) {
    const handler = () => shutdown()
    signalHandlers.set(sig, handler)
    process.on(sig, handler)
  }

  let uncaughtHandler = null
  if (exitOnUncaught) {
    uncaughtHandler = (err) => {
      // Remove handler immediately to prevent double-trigger if shutdown() throws
      process.removeListener('uncaughtException', uncaughtHandler)
      log('fatal', 'lifecycle:uncaught', err.message || String(err), { error: String(err), stack: err.stack || null })
      shutdown()
    }
    process.on('uncaughtException', uncaughtHandler)
  }

  function cleanup() {
    for (const [sig, handler] of signalHandlers) {
      process.removeListener(sig, handler)
    }
    if (uncaughtHandler) {
      process.removeListener('uncaughtException', uncaughtHandler)
    }
  }

  return { ready, stop: shutdown, shutdown, getState: () => state, getStartedAt: () => startedAt, cleanup }
}
