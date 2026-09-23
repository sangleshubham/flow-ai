// /auth/chatgpt/status must answer JSON even when sign-in is not configured (the pane polls it).
import type { NextApiRequest, NextApiResponse } from 'next'
import { describe, expect, it, vi } from 'vitest'

import handler from '../../pages/api/auth/chatgpt/[action]'
import { getIllusServer } from '../llm'

vi.mock('../llm', () => ({ getIllusServer: vi.fn() }))

function call(action: string) {
  const out: { status?: number; json?: unknown; html?: string } = {}
  const res = {
    setHeader: () => res,
    status: (s: number) => ((out.status = s), res),
    json: (b: unknown) => ((out.json = b), res),
    send: (b: string) => ((out.html = b), res),
    end: () => res,
  }
  const req = { method: 'GET', query: { action }, headers: {}, cookies: {} }
  return Promise.resolve(handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse)).then(() => out)
}

describe('/auth/chatgpt/status without sign-in configuration', () => {
  it('answers { configured: false } when the server cannot be built', async () => {
    vi.mocked(getIllusServer).mockRejectedValueOnce(new Error('ILLUS_SESSION_SECRET is missing at /secret/path'))
    const out = await call('status')
    expect(out).toEqual({ status: 200, json: { ok: true, configured: false } })
  })

  it('answers { configured: false } when ChatGPT auth is not set up (replay-only server)', async () => {
    vi.mocked(getIllusServer).mockResolvedValueOnce({ auth: undefined, sessions: { verify: () => null } } as never)
    expect(await call('status')).toEqual({ status: 200, json: { ok: true, configured: false } })
  })

  it('other actions still show the setup page', async () => {
    vi.mocked(getIllusServer).mockResolvedValueOnce({ auth: undefined, sessions: { verify: () => null } } as never)
    const out = await call('start')
    expect(out.status).toBe(500)
    expect(out.html).toContain('Sign-in is not configured')
  })
})

describe('/auth/chatgpt/* on a remote reader (paste sign-in, ADR 0047)', () => {
  function run(action: string, o: { method?: string; body?: unknown; server: unknown }) {
    vi.mocked(getIllusServer).mockResolvedValueOnce(o.server as never)
    const out: { status?: number; html?: string; location?: string; cookies?: unknown } = {}
    const res = {
      setHeader: (k: string, v: unknown) => (k === 'Set-Cookie' && (out.cookies = v), res),
      status: (s: number) => ((out.status = s), res),
      json: () => res,
      send: (b: string) => ((out.html = b), res),
      redirect: (s: number, l: string) => ((out.status = s), (out.location = l), res),
      end: () => res,
    }
    const req = { method: o.method ?? 'GET', query: { action }, headers: {}, cookies: { illus_chatgpt_pending: 'sealed' }, body: o.body }
    return Promise.resolve(handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse)).then(() => out)
  }
  const server = (callback = vi.fn(async () => ({ sub: 'me', email: 'me@x' }))) => ({
    pasteSignin: true,
    auth: { start: async () => ({ url: 'https://auth.test/authorize?a=1&b=2', pending: 'sealed' }), callback },
    sessions: { verify: () => null, issueSession: () => 'illus_session=signed' },
  })

  it('start shows the two-step page instead of redirecting, and sets the pending cookie', async () => {
    const out = await run('start', { server: server() })
    expect(out.status).toBe(200)
    expect(out.html).toContain('href="https://auth.test/authorize?a=1&#38;b=2"')
    expect(out.html).toContain('action="/auth/chatgpt/paste"')
    expect(out.cookies).toMatch(/^illus_chatgpt_pending=sealed;/)
  })

  it('paste completes sign-in with the pasted query and the pending cookie', async () => {
    const callback = vi.fn(async () => ({ sub: 'me', email: 'me@x' }))
    vi.stubEnv('ILLUS_ALLOWED_ACCOUNT_ID', 'me')
    const out = await run('paste', { method: 'POST', body: { url: ' http://127.0.0.1:7199/auth/chatgpt/callback?code=c&state=s ' }, server: server(callback) })
    vi.unstubAllEnvs()
    expect(callback).toHaveBeenCalledWith(new URLSearchParams('code=c&state=s'), 'sealed')
    expect(out).toMatchObject({ status: 303, location: '/' })
    expect(out.cookies).toEqual(['illus_session=signed', expect.stringMatching(/^illus_chatgpt_pending=;.*Max-Age=0/)])
  })

  it('the first sign-in on an unclaimed reader asks for one restart', async () => {
    vi.stubEnv('ILLUS_ALLOWED_ACCOUNT_ID', '')
    const out = await run('paste', { method: 'POST', body: { url: 'http://127.0.0.1:7199/auth/chatgpt/callback?code=c' }, server: server() })
    vi.unstubAllEnvs()
    expect(out.status).toBe(200)
    expect(out.html).toContain('now belongs to me@x')
    expect(out.html).toContain('docker compose restart reader')
  })

  it('paste refuses something that is not a URL', async () => {
    const callback = vi.fn()
    const out = await run('paste', { method: 'POST', body: { url: 'code=c' }, server: server(callback) })
    expect(callback).not.toHaveBeenCalled()
    expect(out.status).toBe(400)
    expect(out.html).toContain('paste the whole address')
  })
})
