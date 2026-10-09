// Visual regression, XSS, sandbox and worker tests for @illus/render (§18), run with `pnpm e2e`.
// Baselines live in test/e2e/__screenshots__ and are platform-specific (Playwright's default naming).
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.e2e.ts',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{platform}{ext}',
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  use: {
    baseURL: 'http://localhost:5199',
    ...devices['Desktop Chrome'],
    viewport: { width: 640, height: 900 },
    deviceScaleFactor: 1,
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'pnpm exec vite --config harness.vite.config.ts',
    url: 'http://localhost:5199/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
