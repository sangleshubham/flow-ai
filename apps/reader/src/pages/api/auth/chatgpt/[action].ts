// /auth/chatgpt/{start,callback,logout,status} (spec §9 "Sign in with ChatGPT", §17), served here through
// the `rewrites()` entry in next.config.js (`locale: false`). Tokens never reach the browser: the
// browser only ever gets the signed session cookie and a sealed, short-lived pending-login cookie.
import { AccountRefusedError } from '@illus/llm/server'
import type { NextApiRequest, NextApiResponse } from 'next'

import { getIllusServer } from '../../../../server/llm'

const PENDING_COOKIE = 'illus_chatgpt_pending'
const PENDING_ATTRS = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=600'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  let server
  try {
    server = await getIllusServer()
  } catch (e) {
    return page(res, 500, 'Sign-in is not configured', (e as Error).message)
  }
  const auth = server.auth
  if (!auth) return page(res, 500, 'Sign-in is not configured', 'Set ILLUS_TOKEN_ENC_KEY and ILLUS_PUBLIC_URL (docs/setup-chatgpt-signin.md).')
  const action = req.query.action
  const session = server.sessions.verify(req.headers.cookie)

  try {
    if (action === 'start' && req.method === 'GET') {
      const { url, pending } = await auth.start()
      res.setHeader('Set-Cookie', `${PENDING_COOKIE}=${pending}; ${PENDING_ATTRS}`)
      return res.redirect(302, url)
    }

    if (action === 'callback' && req.method === 'GET') {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(req.query)) {
        if (k === 'action') continue
        for (const one of Array.isArray(v) ? v : [v ?? '']) params.append(k, one)
      }
      const claims = await auth.callback(params, req.cookies[PENDING_COOKIE])
      res.setHeader('Set-Cookie', [server.sessions.issueSession(claims), `${PENDING_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`])
      return res.redirect(302, '/')
    }

    if (action === 'logout' && req.method === 'POST') {
      if (!session) return res.status(401).json({ ok: false, code: 'auth', message: 'sign in first' })
      const { revoked } = await auth.logout()
      res.setHeader('Set-Cookie', server.sessions.clearCookie())
      return res.status(200).json({ ok: true, revoked })
    }

    if (action === 'status' && req.method === 'GET') {
      if (!session) return res.status(401).json({ ok: false, code: 'auth', message: 'sign in first' })
      return res.status(200).json({ ok: true, ...(await auth.status()), usage: server.usage.summary() })
    }
  } catch (e) {
    if (e instanceof AccountRefusedError) return page(res, 403, 'Account not allowed', e.message)
    return page(res, 400, 'Sign-in failed', (e as Error).message)
  }
  return res.status(404).end()
}

function page(res: NextApiResponse, status: number, title: string, message: string) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
  res
    .status(status)
    .setHeader('Content-Type', 'text/html; charset=utf-8')
    .send(`<!doctype html><title>${esc(title)}</title><h1>${esc(title)}</h1><p>${esc(message)}</p><p><a href="/auth/chatgpt/start">Try again</a></p>`)
}
