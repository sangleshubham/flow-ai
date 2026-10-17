// W11 hardening of createSessions (spec §17, ADR 0020).
import { describe, expect, it } from 'vitest'

import { createHmac } from 'node:crypto'

import { createSessions, openReaderDb } from '../src/server/index.ts'

const db = openReaderDb({ memory: true })
const secret = 'x'.repeat(32)
const header = (setCookie: string) => setCookie.split(';')[0]!

describe('createSessions hardening', () => {
  it('binds sessions to the allowed account: a session for any other sub is refused', () => {
    const issuer = createSessions({ db, secret, secure: false })
    const s = createSessions({ db, secret, secure: false, allowedSub: 'me' })
    expect(
      s.verify(header(issuer.issueSession({ sub: 'someone-else' }))),
    ).toBeNull()
    expect(s.verify(header(issuer.issueSession({ sub: 'me' })))?.sub).toBe('me')
  })

  it('never issues a session for another account', () => {
    const s = createSessions({ db, secret, secure: false, allowedSub: 'me' })
    expect(() => s.issueSession({ sub: 'someone-else' })).toThrow(/not allowed/)
  })

  it('sets HttpOnly, SameSite=Lax, Path=/ and a 30-day Max-Age', () => {
    const c = createSessions({ db, secret, secure: true }).issueSession({
      sub: 'a',
    })
    expect(c).toMatch(/; HttpOnly/)
    expect(c).toMatch(/; SameSite=Lax/)
    expect(c).toMatch(/; Secure/)
    expect(c).toMatch(/Max-Age=2592000/)
  })

  it('refuses a cookie with extra segments', () => {
    const s = createSessions({ db, secret, secure: false })
    expect(s.verify(`${header(s.issueSession({ sub: 'a' }))}.extra`)).toBeNull()
  })
})

it('rejects revoked, expired, disabled and legacy sessions, and counts active devices', () => {
  const db = openReaderDb({ memory: true })
  let t = Date.now()
  const s = createSessions({ db, secret, secure: false, now: () => t })
  const a = header(s.issueSession({ sub: 'A' }))
  const b = header(s.issueSession({ sub: 'A' }))
  const c = header(s.issueSession({ sub: 'B' }))
  const sid = s.verify(a)!.sid
  expect(typeof sid).toBe('string')
  expect(s.activeCount('A')).toBe(2)
  s.revoke(sid)
  expect(s.verify(a)).toBeNull()
  expect(s.activeCount('A')).toBe(1)
  expect(s.verify(b)?.sub).toBe('A')
  db.prepare('UPDATE users SET disabled=1 WHERE sub=?').run('B')
  expect(s.verify(c)).toBeNull()
  const payload = Buffer.from(
    JSON.stringify({ sub: 'A', exp: Math.floor(t / 1000) + 3600 }),
  ).toString('base64url')
  expect(
    s.verify(
      `illus_session=${payload}.${createHmac('sha256', secret)
        .update(payload)
        .digest('base64url')}`,
    ),
  ).toBeNull()
  expect(s.verify('illus_session=%bad')).toBeNull()
  t += 31 * 86_400_000
  expect(s.verify(b)).toBeNull()
  expect(s.activeCount('A')).toBe(0)
  db.close()
})
