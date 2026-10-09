import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { classify, verifySessionValue } from './gate'

describe('classify', () => {
  it.each([
    ['/login', 'public'],
    ['/de-DE/login', 'public'],
    ['/auth/chatgpt/start', 'public'],
    ['/auth/chatgpt/callback', 'public'],
    ['/zh-CN/auth/chatgpt/callback', 'public'],
    ['/api/auth/chatgpt/start', 'public'],
    ['/api/login', 'public'],
    ['/_next/static/chunks/main.js', 'public'],
    ['/illus-sandbox.html', 'public'],
    ['/theme-init.js', 'public'],
    ['/icons/192.png', 'public'],
    ['/pyodide/pyodide.asm.wasm', 'public'],
  ])('%s is %s', (path, access) => expect(classify(path)).toBe(access))

  it.each([
    ['/', 'page'],
    ['/_', 'page'],
    ['/de-DE', 'page'],
    ['/de-DE/', 'page'],
    ['/login-other', 'page'],
    ['/auth/other', 'page'],
    ['/api/llm', 'api'],
    ['/api/llm/usage', 'api'],
    ['/api/llm.json', 'api'],
    ['/de-DE/api/llm', 'api'],
    ['/_next/data/build/index.json', 'api'],
    ['/api/auth/other', 'api'],
  ])('%s is gated as %s', (path, access) => expect(classify(path)).toBe(access))
})

describe('verifySessionValue (same format as @illus/llm/server createSessions)', () => {
  const secret = 's'.repeat(40)
  const make = (claims: object, key = secret) => {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
  }
  const now = 1_000_000

  it('accepts a valid session for the allowed account', async () => {
    expect(await verifySessionValue(make({ sub: 'me', exp: now + 10 }), { secret, allowedSub: 'me', nowS: now })).toBe(true)
  })

  it('refuses a session signed for any other account', async () => {
    expect(await verifySessionValue(make({ sub: 'other', exp: now + 10 }), { secret, allowedSub: 'me', nowS: now })).toBe(false)
  })

  it('refuses forged, expired, malformed and missing sessions', async () => {
    const opts = { secret, allowedSub: 'me', nowS: now }
    expect(await verifySessionValue(make({ sub: 'me', exp: now + 10 }, 'x'.repeat(40)), opts)).toBe(false)
    expect(await verifySessionValue(make({ sub: 'me', exp: now - 1 }), opts)).toBe(false)
    expect(await verifySessionValue('garbage', opts)).toBe(false)
    expect(await verifySessionValue(`${make({ sub: 'me', exp: now + 10 })}x`, opts)).toBe(false)
    expect(await verifySessionValue(undefined, opts)).toBe(false)
  })

  it('refuses everything when the secret or the allowed account is not configured', async () => {
    const v = make({ sub: 'me', exp: now + 10 })
    expect(await verifySessionValue(v, { secret: undefined, allowedSub: 'me', nowS: now })).toBe(false)
    expect(await verifySessionValue(v, { secret: 'short', allowedSub: 'me', nowS: now })).toBe(false)
    expect(await verifySessionValue(v, { secret, allowedSub: undefined, nowS: now })).toBe(false)
  })
})
