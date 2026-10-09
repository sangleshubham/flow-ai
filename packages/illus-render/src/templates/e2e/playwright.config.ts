// Visual regression for the template library (§18), light and dark, from each template's example.
// Run: `pnpm exec playwright test -c src/templates/e2e` (from packages/illus-render). Baselines are
// platform-suffixed in ./__screenshots__ (darwin only so far, like W4's).
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// eslint-disable-next-line no-restricted-syntax -- Playwright and Vite load their config from a default export.
export default defineConfig({
  testDir: here('.'),
  testMatch: '**/*.e2e.ts',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{platform}{ext}',
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  use: {
    baseURL: 'http://localhost:5198',
    ...devices['Desktop Chrome'],
    viewport: { width: 640, height: 900 },
    deviceScaleFactor: 1,
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'pnpm exec vite --config src/templates/e2e/vite.config.ts',
    cwd: here('../../..'),
    url: 'http://localhost:5198/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
