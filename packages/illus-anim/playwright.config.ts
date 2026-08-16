import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:5206',
    browserName: 'chromium',
    viewport: { width: 900, height: 800 },
  },
  webServer: {
    command: 'pnpm exec vite --config harness.vite.config.ts',
    url: 'http://localhost:5206',
    reuseExistingServer: !process.env.CI,
  },
})
