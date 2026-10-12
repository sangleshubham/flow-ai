// Signed cookie plus revocable server-side session (ADR 0055). Keep claims in step with the Edge gate.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import type { ReaderDb } from './db.ts'

export const SESSION_COOKIE = 'illus_session'
const MAX_AGE_S = 30 * 24 * 3600

export interface SessionClaims {
  sid: string
  sub: string
  email?: string
  /** Epoch seconds. */
  exp: number
}

export interface Sessions {
  issueSession(idClaims: { sub: string; email?: string }): string
  verify(cookieHeader: string | undefined): SessionClaims | null
  revoke(sid: string): void
  activeCount(sub: string): number
  clearCookie(): string
}

export function createSessions(o: {
  secret: string | undefined
  secure: boolean
  db: ReaderDb
  allowedSub?: string | undefined
  now?: () => number
}): Sessions {
  if (!o.secret || o.secret.length < 32)
    throw new Error('ILLUS_SESSION_SECRET must be at least 32 characters')
  const now = o.now ?? Date.now
  const sign = (payload: string) =>
    createHmac('sha256', o.secret!).update(payload).digest('base64url')
  const attrs = `Path=/; HttpOnly; SameSite=Lax${o.secure ? '; Secure' : ''}`
  const touched = new Map<string, number>()
  return {
    issueSession(idClaims) {
      if (!idClaims.sub || (o.allowedSub && idClaims.sub !== o.allowedSub))
        throw new Error('account not allowed')
      const t = now()
      const user = o.db
        .prepare('SELECT disabled FROM users WHERE sub=?')
        .get(idClaims.sub)
      if (user?.disabled) throw new Error('account disabled')
      o.db
        .prepare(
          `INSERT INTO users(sub,email,created_at,last_seen_at) VALUES(?,?,?,?)
        ON CONFLICT(sub) DO UPDATE SET last_seen_at=excluded.last_seen_at`,
        )
        .run(idClaims.sub, idClaims.email ?? null, t, t)
      const claims: SessionClaims = {
        sid: randomBytes(24).toString('base64url'),
        sub: idClaims.sub,
        ...(idClaims.email && { email: idClaims.email }),
        exp: Math.floor(t / 1000) + MAX_AGE_S,
      }
      o.db
        .prepare(
          'INSERT INTO sessions(id,sub,created_at,expires_at) VALUES(?,?,?,?)',
        )
        .run(claims.sid, claims.sub, t, claims.exp * 1000)
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      return `${SESSION_COOKIE}=${payload}.${sign(
        payload,
      )}; Max-Age=${MAX_AGE_S}; ${attrs}`
    },
    verify(cookieHeader) {
      const value = readCookie(cookieHeader, SESSION_COOKIE)
      const [payload, mac, extra] = value?.split('.') ?? []
      if (!payload || !mac || extra !== undefined) return null
      const expected = Buffer.from(sign(payload))
      const given = Buffer.from(mac)
      if (expected.length !== given.length || !timingSafeEqual(expected, given))
        return null
      try {
        const claims = JSON.parse(
          Buffer.from(payload, 'base64url').toString('utf8'),
        ) as SessionClaims
        const t = now()
        if (
          !claims ||
          typeof claims.sid !== 'string' ||
          !claims.sid ||
          typeof claims.sub !== 'string' ||
          !claims.sub ||
          typeof claims.exp !== 'number' ||
          claims.exp * 1000 <= t
        )
          return null
        if (o.allowedSub && claims.sub !== o.allowedSub) return null
        const row = o.db
          .prepare(
            `SELECT s.id FROM sessions s JOIN users u ON u.sub=s.sub
          WHERE s.id=? AND s.sub=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.disabled=0`,
          )
          .get(claims.sid, claims.sub, t)
        if (!row) return null
        if (t - (touched.get(claims.sub) ?? -Infinity) >= 60_000) {
          o.db
            .prepare('UPDATE users SET last_seen_at=? WHERE sub=?')
            .run(t, claims.sub)
          touched.set(claims.sub, t)
        }
        return claims
      } catch {
        return null
      }
    },
    revoke(sid) {
      o.db
        .prepare(
          'UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL',
        )
        .run(now(), sid)
    },
    activeCount(sub) {
      return Number(
        o.db
          .prepare(
            `SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.sub=s.sub
        WHERE s.sub=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.disabled=0`,
          )
          .get(sub, now())!.n,
      )
    },
    clearCookie: () => `${SESSION_COOKIE}=; Max-Age=0; ${attrs}`,
  }
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim())
      } catch {
        return undefined
      }
    }
  }
  return undefined
}
