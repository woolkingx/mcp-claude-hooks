#!/usr/bin/env node
// cli.mjs — CLI entry point. Injects 'cli' mode, then boots via mcp.mjs.
if (!process.argv.includes('cli') && !process.argv.includes('--cli')) {
  process.argv.splice(2, 0, 'cli')
}
const { boot } = await import('./mcp.mjs')
const { core } = boot()
const argv = process.argv.slice(2)
const cliIdx = Math.max(argv.indexOf('cli'), argv.indexOf('--cli'))
const cliArgs = argv.slice(cliIdx + 1).filter(a => a !== '--debug')
const { runCLI } = await import('./adapters/cli.mjs')
runCLI(core, cliArgs)
