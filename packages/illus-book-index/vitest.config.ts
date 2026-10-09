import { defineConfig } from 'vitest/config'

// Unit, rule and fixture tests in jsdom. Real-browser tests (*.browser.test.ts) run via `pnpm e2e`.
export default defineConfig({
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'], exclude: ['test/**/*.browser.test.ts'] },
})
