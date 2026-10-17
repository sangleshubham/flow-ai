// Throwaway values for E2E only; never real credentials.
import { createHmac } from 'node:crypto'

import type { BrowserContext } from '@playwright/test'

export const E2E_PORT = 3123

export const E2E_ENV = {
  ILLUS_LLM_MODE: 'replay',
  ILLUS_ACCESS: 'open',
  ILLUS_SESSION_SECRET: 'e2e-session-secret-not-a-real-secret-0123456789',
  ILLUS_ALLOWED_ACCOUNT_ID: 'e2e-allowed-account',
  ILLUS_LOGIN_PASSWORD: 'e2e-password-not-real-0123',
}

/** A session cookie value in the `@illus/llm/server` format, signed with the E2E secret. */
export function sessionValue(
  sub: string,
  expS = Math.floor(Date.now() / 1000) + 3600,
): string {
  const payload = Buffer.from(
    JSON.stringify({ sid: 'no-database-row', sub, exp: expS }),
  ).toString('base64url')
  return `${payload}.${createHmac('sha256', E2E_ENV.ILLUS_SESSION_SECRET)
    .update(payload)
    .digest('base64url')}`
}

// Use the actual password route: a signed cookie alone cannot create a database session.
let cookie: string | undefined
export async function signIn(context: BrowserContext) {
  if (!cookie) {
    const res = await context.request.post('/api/login', {
      form: { password: E2E_ENV.ILLUS_LOGIN_PASSWORD },
      maxRedirects: 0,
    })
    if (
      res.status() !== 303 ||
      !res.headers()['set-cookie']?.startsWith('illus_session=')
    )
      throw new Error('E2E password sign-in failed')
    cookie = res
      .headers()
      ['set-cookie']!.split(';')[0]!
      .slice('illus_session='.length)
  }
  await context.addCookies([
    {
      name: 'illus_session',
      value: cookie,
      url: `http://127.0.0.1:${E2E_PORT}`,
    },
  ])
}
