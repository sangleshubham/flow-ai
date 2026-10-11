// /auth/chatgpt/{start,callback,paste,logout,status} (spec §9 "Sign in with ChatGPT", §17), served here through
// the `rewrites()` entry in next.config.js (`locale: false`). Tokens never reach the browser: the
// browser only ever gets the signed session cookie and a sealed, short-lived pending-login cookie.
import { AccountRefusedError } from '@illus/llm/server'
import type { NextApiRequest, NextApiResponse } from 'next'

import { getIllusServer } from '../../../../server/llm'

const PENDING_COOKIE = 'illus_chatgpt_pending'
const PENDING_ATTRS = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=600'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  const action = req.query.action
  // Status is polled by the pane, so an unconfigured server answers JSON, not an error page. The
  // configuration error itself is not echoed (it may name env vars or paths).
  const unconfigured = (title: string, message: string) => {
    if (action !== 'status') return page(res, 500, title, message)
    console.warn(`/auth/chatgpt/status: ${message}`)
    return res.status(200).json({ ok: true, configured: false })
  }
  let server
  try {
    server = await getIllusServer()
  } catch (e) {
    return unconfigured('Sign-in is not configured', (e as Error).message)
  }
  const auth = server.auth
  if (!auth) return unconfigured('Sign-in is not configured', 'Set ILLUS_TOKEN_ENC_KEY (docs/setup-chatgpt-signin.md).')
  const session = server.sessions.verify(req.headers.cookie)

  const signIn = async (params: URLSearchParams) => {
    const claims = await auth.callback(params, req.cookies[PENDING_COOKIE])
    res.setHeader('Set-Cookie', [server.sessions.issueSession(claims), `${PENDING_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`])
    // The first sign-in claimed the reader (ADR 0047). The Edge gate only admits ILLUS_ALLOWED_ACCOUNT_ID,
    // which the container entrypoint reads from the saved registration at start-up.
    if (!process.env.ILLUS_ALLOWED_ACCOUNT_ID?.trim())
      return page(res, 200, 'Reader claimed', `This reader now belongs to ${claims.email ?? claims.sub}. Restart the server once (docker compose restart reader), then open the reader.`, '/')
    return res.redirect(303, '/')
  }

  try {
    if (action === 'start' && req.method === 'GET') {
      const { url, pending } = await auth.start()
      res.setHeader('Set-Cookie', `${PENDING_COOKIE}=${pending}; ${PENDING_ATTRS}`)
      return server.pasteSignin ? pastePage(res, url) : res.redirect(302, url)
    }

    if (action === 'callback' && req.method === 'GET') {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(req.query)) {
        if (k === 'action') continue
        for (const one of Array.isArray(v) ? v : [v ?? '']) params.append(k, one)
      }
      return await signIn(params)
    }

    // Remote reader (ADR 0047): the address OpenAI redirected to on 127.0.0.1, pasted by the user. The
    // pending cookie's state, nonce and PKCE verifier still bind it to the sign-in this browser started.
    if (action === 'paste' && req.method === 'POST') {
      const pasted = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
      let params: URLSearchParams
      try {
        params = new URL(pasted).searchParams
      } catch {
        throw new Error('that is not the address from the sign-in tab; start again and paste the whole address')
      }
      return await signIn(params)
    }

    if (action === 'logout' && req.method === 'POST') {
      if (!session) return res.status(401).json({ ok: false, code: 'auth', message: 'sign in first' })
      const { revoked } = await auth.logout()
      res.setHeader('Set-Cookie', server.sessions.clearCookie())
      return res.status(200).json({ ok: true, revoked })
    }

    if (action === 'status' && req.method === 'GET') {
      if (!session) return res.status(401).json({ ok: false, code: 'auth', message: 'sign in first' })
      return res.status(200).json({ ok: true, configured: true, ...(await auth.status()), usage: server.usage.summary() })
    }
  } catch (e) {
    if (e instanceof AccountRefusedError) return page(res, 403, 'Account not allowed', e.message)
    return page(res, 400, 'Sign-in failed', (e as Error).message)
  }
  return res.status(404).end()
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function pastePage(res: NextApiResponse, url: string) {
  res
    .status(200)
    .setHeader('Content-Type', 'text/html; charset=utf-8')
    .send(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">` +
        `<title>Continue with ChatGPT</title>` +
        `<style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#111}` +
        `a.b,button{display:inline-block;background:#000;color:#fff;border:0;border-radius:6px;padding:.6rem 1rem;font:inherit;text-decoration:none;cursor:pointer}` +
        `input{width:100%;box-sizing:border-box;padding:.5rem;font:inherit;border:1px solid #ccc;border-radius:6px;margin:.5rem 0}</style>` +
        `<h1>Continue with ChatGPT</h1>` +
        `<p><b>1.</b> Sign in with ChatGPT in a new tab and allow plan usage.</p>` +
        `<p><a class="b" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open ChatGPT sign-in</a></p>` +
        `<p><b>2.</b> That tab ends on a page that cannot load, at an address starting with <code>http://127.0.0.1</code>. ` +
        `This is expected. Copy the whole address from that tab and paste it here within 10 minutes.</p>` +
        `<form method="post" action="/auth/chatgpt/paste"><input name="url" required autocomplete="off" placeholder="http://127.0.0.1:7199/auth/chatgpt/callback?code=…">` +
        `<button type="submit">Finish sign-in</button></form>`,
    )
}

function page(res: NextApiResponse, status: number, title: string, message: string, next?: string) {
  const link = next ? `<a href="${esc(next)}">Open the reader</a>` : '<a href="/auth/chatgpt/start">Try again</a>'
  res
    .status(status)
    .setHeader('Content-Type', 'text/html; charset=utf-8')
    .send(`<!doctype html><title>${esc(title)}</title><h1>${esc(title)}</h1><p>${esc(message)}</p><p>${link}</p>`)
}
