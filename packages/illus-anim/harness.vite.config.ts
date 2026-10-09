import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
export default defineConfig({
  root: fileURLToPath(new URL('./test/harness', import.meta.url)),
  server: { port: 5206, strictPort: true },
  worker: { format: 'es' },
  optimizeDeps: {
    include: [
      'react',
      'react-dom/client',
      'motion',
      'motion/react',
      'gsap',
      'gsap/DrawSVGPlugin',
      'gsap/MotionPathPlugin',
    ],
  },
})
