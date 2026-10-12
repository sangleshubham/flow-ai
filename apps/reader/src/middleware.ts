// Auth gate and unauthenticated sign-in protection (spec §17, ADR 0020). Defence in depth (ADR 0005): every API route
// and /auth/chatgpt/* handler also checks the session itself, because Next 12 middleware can be bypassed
// on i18n apps (GHSA-36qx-fr4f-26g5).
/* eslint-disable @next/next/no-server-import-in-page -- the rule predates root middleware (Next 12.2+) */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import {
  SIGNIN_ROUTE,
  SESSION_COOKIE,
  classify,
  verifySessionValue,
} from './security/gate'
import { createRateLimiter } from './security/rate-limit'

const authLimit = createRateLimiter({ capacity: 10, perMs: 60_000 })

// Only `next dev` may switch the gate off; production builds (next start, Docker) are always gated.
const GATE_OFF =
  process.env.NODE_ENV !== 'production' && process.env.ILLUS_AUTH_GATE === 'off'

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const access = classify(pathname)
  if (SIGNIN_ROUTE.test(pathname)) {
    const ip =
      req.headers.get('x-real-ip')?.trim() ||
      req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() ||
      'anon'
    const result = authLimit(ip)
    if (!result.ok) {
      const res = json(429, {
        ok: false,
        message: 'Too many sign-in attempts. Wait a minute and try again.',
      })
      res.headers.set(
        'Retry-After',
        String(Math.ceil(result.retryAfterMs! / 1000)),
      )
      return res
    }
  }
  if (access === 'public' || GATE_OFF) return NextResponse.next()

  const cookie = req.cookies.get(SESSION_COOKIE)
  const ok = await verifySessionValue(cookie, {
    secret: process.env.ILLUS_SESSION_SECRET,
    allowedSub: process.env.ILLUS_ALLOWED_ACCOUNT_ID?.trim(),
    nowS: Math.floor(Date.now() / 1000),
    open: (process.env.ILLUS_ACCESS ?? 'open') !== 'owner',
  })

  if (!ok) {
    if (access === 'api')
      return json(401, { ok: false, code: 'auth', message: 'sign in first' })
    const login = req.nextUrl.clone()
    login.pathname = '/login'
    login.search = ''
    login.searchParams.set('next', pathname + search)
    return NextResponse.redirect(login)
  }

  return NextResponse.next()
}

function json(status: number, body: unknown) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  })
}
