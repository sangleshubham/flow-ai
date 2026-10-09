import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: { jsx: { runtime: 'classic' } },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
