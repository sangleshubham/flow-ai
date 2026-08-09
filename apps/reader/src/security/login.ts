// Password login helpers for the Tailscale-only VPS gate (ADR 0020). Node only.
import { createHash, timingSafeEqual } from 'node:crypto'

export const MIN_PASSWORD_LENGTH = 16

/** Only same-site paths, so `?next=` cannot redirect off the app. */
export function safeNext(value: unknown): string {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : '/'
}

/** Constant-time comparison against `ILLUS_LOGIN_PASSWORD`; a missing or short password admits nobody. */
export function passwordMatches(given: unknown, configured: string | undefined): boolean {
  if (typeof given !== 'string' || !configured || configured.length < MIN_PASSWORD_LENGTH) return false
  const h = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(h(given), h(configured))
}
