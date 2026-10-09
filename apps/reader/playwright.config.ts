// Security E2E for the reader (W11, spec §17, §18): runs the production build behind the login gate in
// replay mode with throwaway test secrets. `pnpm e2e` builds first; set E2E_SKIP_BUILD=1 to reuse .next.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { E2E_ENV, E2E_PORT } from './e2e/env'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${E2E_PORT}`, ...devices['Desktop Chrome'] },
  projects: [{ name: 'chromium' }],
  // E2E_EXTERNAL_SERVER=1: test a server already listening on E2E_PORT with E2E_ENV (e.g. the Docker image).
  webServer: process.env.E2E_EXTERNAL_SERVER ? undefined : {
    command: `${process.env.E2E_SKIP_BUILD ? '' : 'pnpm build && '}pnpm exec next start -p ${E2E_PORT}`,
    url: `http://127.0.0.1:${E2E_PORT}/login`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      ...E2E_ENV,
      ILLUS_DATA_DIR: mkdtempSync(join(tmpdir(), 'illus-e2e-')),
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
})
