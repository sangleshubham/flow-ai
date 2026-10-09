// Signed session cookie (§17 "Session"): HMAC-SHA256 over `{sub, email, exp}` with
// `ILLUS_SESSION_SECRET`; HttpOnly, SameSite=Lax, 30 days, Secure on https. Hardened by W11 (ADR 0020):
// bound to `ILLUS_ALLOWED_ACCOUNT_ID` when given. The Edge middleware verifies the same format
// (`apps/reader/src/security/gate.ts`), so keep the two in step.
import { createHmac, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'illus_session'
const MAX_AGE_S = 30 * 24 * 3600

export interface SessionClaims {
  sub: string
  email?: string
  /** Epoch seconds. */
  exp: number
}

export interface Sessions {
  /** Signs a session for verified ID-token claims; returns the `Set-Cookie` header value. */
  issueSession(idClaims: { sub: string; email?: string }): string
  /** The session in a `Cookie` header, or null when absent, forged or expired. */
  verify(cookieHeader: string | undefined): SessionClaims | null
  /** `Set-Cookie` value that removes the session. */
  clearCookie(): string
}

export function createSessions(o: {
  secret: string | undefined
  secure: boolean
  /** Only this account may hold a session (`ILLUS_ALLOWED_ACCOUNT_ID`). */
  allowedSub?: string | undefined
  now?: () => number
}): Sessions {
  if (!o.secret || o.secret.length < 32) throw new Error('ILLUS_SESSION_SECRET must be at least 32 characters')
  const now = () => Math.floor((o.now ?? Date.now)() / 1000)
  const sign = (payload: string) => createHmac('sha256', o.secret!).update(payload).digest('base64url')
  const attrs = `Path=/; HttpOnly; SameSite=Lax${o.secure ? '; Secure' : ''}`
  return {
    issueSession(idClaims) {
      if (o.allowedSub && idClaims.sub !== o.allowedSub) throw new Error('account not allowed')
      const claims: SessionClaims = { sub: idClaims.sub, ...(idClaims.email && { email: idClaims.email }), exp: now() + MAX_AGE_S }
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      return `${SESSION_COOKIE}=${payload}.${sign(payload)}; Max-Age=${MAX_AGE_S}; ${attrs}`
    },
    verify(cookieHeader) {
      const value = readCookie(cookieHeader, SESSION_COOKIE)
      const [payload, mac, extra] = value?.split('.') ?? []
      if (!payload || !mac || extra !== undefined) return null
      const expected = Buffer.from(sign(payload))
      const given = Buffer.from(mac)
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
      try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims
        if (typeof claims.sub !== 'string' || !(claims.exp > now())) return null
        return !o.allowedSub || claims.sub === o.allowedSub ? claims : null
      } catch {
        return null
      }
    },
    clearCookie: () => `${SESSION_COOKIE}=; Max-Age=0; ${attrs}`,
  }
}

/** Reads one cookie from a `Cookie` header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return undefined
}
