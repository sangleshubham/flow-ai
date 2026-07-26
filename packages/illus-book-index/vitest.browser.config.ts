// Real-browser tests (Vitest browser mode on Playwright Chromium): `pnpm e2e`. Not part of `pnpm test`.
// Needs a browser: `pnpm exec playwright install chromium`, or ILLUS_PW_CHANNEL=chrome to use installed Chrome.
import { resolve } from 'node:path'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const fixtures = resolve(import.meta.dirname, '../../fixtures/books')

export default defineConfig({
  define: { __FIXTURE_BOOKS__: JSON.stringify(`/@fs${fixtures}`) },
  server: { fs: { allow: [import.meta.dirname, fixtures, resolve(import.meta.dirname, '../..')] } },
  test: {
    include: ['test/**/*.browser.test.ts'],
    testTimeout: 30_000,
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright({ launchOptions: { channel: process.env.ILLUS_PW_CHANNEL || undefined } }),
      instances: [{ browser: 'chromium' }],
    },
  },
})
