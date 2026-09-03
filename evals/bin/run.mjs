// Runs a TypeScript entry of @illus/evals through Vite's SSR module loader, because the eval imports
// TSX (W5's templates) and Flow's epub.js (extensionless imports), which plain `node` cannot load.
// Usage: node bin/run.mjs <entry.ts> [args]
import { resolve } from 'node:path'

import { createServer } from 'vite'

const [entry, ...args] = process.argv.slice(2)
if (!entry) throw new Error('usage: node bin/run.mjs <entry.ts> [args]')
process.argv = [process.argv[0], resolve(entry), ...args]

const server = await createServer({
  configFile: false,
  logLevel: 'warn',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  // Workspace packages are source: transform them, never externalise.
  ssr: { noExternal: [/^@flow\//, /^@illus\//] },
})
try {
  await server.ssrLoadModule(resolve(entry))
} finally {
  await server.close()
}
