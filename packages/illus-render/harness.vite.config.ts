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
  // Pre-bundle everything up front: a late discovery (e.g. from the worker) reloads the page mid-test.
  optimizeDeps: {
    include: [
      'react',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom/client',
      'mermaid',
      'vega-embed',
      'vega-interpreter',
      'katex',
      'dompurify',
      'elkjs/lib/elk.bundled.js',
      'comlink',
      'zod',
    ],
  },
})
