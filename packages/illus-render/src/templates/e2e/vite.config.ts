// Vite dev server for the template harness (Playwright only; the app bundles @illus/render from source).
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

// eslint-disable-next-line no-restricted-syntax -- Playwright and Vite load their config from a default export.
export default defineConfig({
  root: fileURLToPath(new URL('./harness', import.meta.url)),
  server: { port: 5198, strictPort: true },
  logLevel: 'warn',
  worker: { format: 'es' },
  optimizeDeps: {
    include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', 'elkjs/lib/elk.bundled.js', 'comlink', 'zod', 'd3-hierarchy', 'mermaid', 'vega-embed', 'vega-interpreter', 'katex', 'dompurify'],
  },
})
