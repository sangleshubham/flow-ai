import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  root: fileURLToPath(new URL('./test/harness', import.meta.url)),
  publicDir: fileURLToPath(
    new URL('../../apps/reader/public', import.meta.url),
  ),
  server: { port: 5277, strictPort: true },
  logLevel: 'warn',
  optimizeDeps: {
    include: [
      'react',
      'react/jsx-runtime',
      'react-dom/client',
      'comlink',
      'shiki',
      '@illus/core > zod',
      ...[
        'mermaid',
        'vega-embed',
        'vega-interpreter',
        'katex',
        'dompurify',
        'elkjs/lib/elk.bundled.js',
        'd3-hierarchy',
      ].map((d) => `@illus/render > ${d}`),
    ],
  },
})
