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
