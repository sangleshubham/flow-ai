// Runs a TypeScript entry of @illus/evals through Vite's module runner, because the eval imports
// TSX (W5's templates) and Flow's epub.js, which plain `node` cannot load. Usage: node bin/run.mjs <entry.ts> [args]
import { resolve } from 'node:path'

import { runnerImport } from 'vite'

const [entry, ...args] = process.argv.slice(2)
if (!entry) throw new Error('usage: node bin/run.mjs <entry.ts> [args]')
process.argv = [process.argv[0], resolve(entry), ...args]
await runnerImport(resolve(entry), { configFile: false, logLevel: 'warn' })
