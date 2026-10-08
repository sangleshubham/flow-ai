// Vite dev server for the Playwright harness (test/harness). Not used by the app build: Next.js bundles
// @illus/render from source (docs/flow-audit.md §11).
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('./test/harness', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../apps/reader/public', import.meta.url)),
  server: { port: 5199, strictPort: true },
  logLevel: 'warn',
  worker: { format: 'es' },
})
