import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  workers: 1,
  use: { baseURL: 'http://localhost:5277', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'pnpm exec vite --config harness.vite.config.ts',
    url: 'http://localhost:5277',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
