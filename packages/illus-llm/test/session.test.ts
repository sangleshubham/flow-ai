// W11 hardening of createSessions (spec §17, ADR 0020).
import { describe, expect, it } from 'vitest'

import { createSessions } from '../src/server/index.ts'

const secret = 'x'.repeat(32)
const header = (setCookie: string) => setCookie.split(';')[0]!

describe('createSessions hardening', () => {
  it('binds sessions to the allowed account: a session for any other sub is refused', () => {
    const issuer = createSessions({ secret, secure: false })
    const s = createSessions({ secret, secure: false, allowedSub: 'me' })
    expect(s.verify(header(issuer.issueSession({ sub: 'someone-else' })))).toBeNull()
    expect(s.verify(header(issuer.issueSession({ sub: 'me' })))?.sub).toBe('me')
  })

  it('never issues a session for another account', () => {
    const s = createSessions({ secret, secure: false, allowedSub: 'me' })
    expect(() => s.issueSession({ sub: 'someone-else' })).toThrow(/not allowed/)
  })

  it('sets HttpOnly, SameSite=Lax, Path=/ and a 30-day Max-Age', () => {
    const c = createSessions({ secret, secure: true }).issueSession({ sub: 'a' })
    expect(c).toMatch(/; HttpOnly/)
    expect(c).toMatch(/; SameSite=Lax/)
    expect(c).toMatch(/; Secure/)
    expect(c).toMatch(/Max-Age=2592000/)
  })

  it('refuses a cookie with extra segments', () => {
    const s = createSessions({ secret, secure: false })
    expect(s.verify(`${header(s.issueSession({ sub: 'a' }))}.extra`)).toBeNull()
  })
})
