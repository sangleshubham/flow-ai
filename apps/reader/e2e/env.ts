// Throwaway values for E2E only; never real credentials.
import { createHmac } from 'node:crypto'

export const E2E_PORT = 3123

export const E2E_ENV = {
  ILLUS_LLM_MODE: 'replay',
  ILLUS_SESSION_SECRET: 'e2e-session-secret-not-a-real-secret-0123456789',
  ILLUS_ALLOWED_ACCOUNT_ID: 'e2e-allowed-account',
  ILLUS_LOGIN_PASSWORD: 'e2e-password-not-real-0123',
}

/** A session cookie value in the `@illus/llm/server` format, signed with the E2E secret. */
export function sessionValue(sub: string, expS = Math.floor(Date.now() / 1000) + 3600): string {
  const payload = Buffer.from(JSON.stringify({ sub, exp: expS })).toString('base64url')
  return `${payload}.${createHmac('sha256', E2E_ENV.ILLUS_SESSION_SECRET).update(payload).digest('base64url')}`
}
