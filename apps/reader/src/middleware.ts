// Auth gate and /api/llm rate limit (spec §17, ADR 0020). Defence in depth (ADR 0005): every API route
// and /auth/chatgpt/* handler also checks the session itself, because Next 12 middleware can be bypassed
// on i18n apps (GHSA-36qx-fr4f-26g5).
/* eslint-disable @next/next/no-server-import-in-page -- the rule predates root middleware (Next 12.2+) */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { LLM_ROUTE, SESSION_COOKIE, classify, verifySessionValue } from './security/gate'
import { createRateLimiter } from './security/rate-limit'

const llmLimit = createRateLimiter({ capacity: 60, perMs: 60_000 })

// Only `next dev` may switch the gate off; production builds (next start, Docker) are always gated.
const GATE_OFF = process.env.NODE_ENV !== 'production' && process.env.ILLUS_AUTH_GATE === 'off'

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const access = classify(pathname)
  if (access === 'public' || GATE_OFF) return NextResponse.next()

  const cookie = req.cookies.get(SESSION_COOKIE)
  const ok = await verifySessionValue(cookie, {
    secret: process.env.ILLUS_SESSION_SECRET,
    allowedSub: process.env.ILLUS_ALLOWED_ACCOUNT_ID?.trim(),
    nowS: Math.floor(Date.now() / 1000),
  })

  if (!ok) {
    if (access === 'api') return json(401, { ok: false, code: 'auth', message: 'sign in first' })
    const login = req.nextUrl.clone()
    login.pathname = '/login'
    login.search = ''
    login.searchParams.set('next', pathname + search)
    return NextResponse.redirect(login)
  }

  if (LLM_ROUTE.test(pathname)) {
    // Keyed by the signed cookie: one bucket per session.
    const r = llmLimit(cookie!)
    if (!r.ok) {
      const res = json(429, { ok: false, code: 'upstream', message: 'Too many requests: /api/llm allows 60 per minute', retryAfterMs: r.retryAfterMs })
      res.headers.set('Retry-After', String(Math.ceil(r.retryAfterMs! / 1000)))
      return res
    }
  }
  return NextResponse.next()
}

function json(status: number, body: unknown) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
