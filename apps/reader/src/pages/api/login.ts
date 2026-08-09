// POST /api/login: password login for the Tailscale-only VPS (ADR 0020). Issues the same signed session
// as "Continue with ChatGPT", always for ILLUS_ALLOWED_ACCOUNT_ID. DELETE signs out of the app only
// (the ChatGPT tokens stay; revoking them is POST /auth/chatgpt/logout).
import { createSessions } from '@illus/llm/server'
import type { NextApiRequest, NextApiResponse } from 'next'

import { passwordMatches, safeNext } from '../../security/login'
import { createRateLimiter } from '../../security/rate-limit'

// One global bucket: 5 attempts per minute in total, whatever the source address.
const attempts = createRateLimiter({ capacity: 5, perMs: 60_000 })

function sessions() {
  const allowedSub = process.env.ILLUS_ALLOWED_ACCOUNT_ID?.trim()
  if (!allowedSub) throw new Error('ILLUS_ALLOWED_ACCOUNT_ID is not set')
  return {
    allowedSub,
    s: createSessions({
      secret: process.env.ILLUS_SESSION_SECRET,
      secure: (process.env.ILLUS_PUBLIC_URL ?? '').startsWith('https:'),
      allowedSub,
    }),
  }
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  const back = (error: string) => res.redirect(303, `/login?error=${error}&next=${encodeURIComponent(safeNext(req.body?.next))}`)

  let config
  try {
    config = sessions()
  } catch {
    return back('config')
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', config.s.clearCookie())
    return res.status(204).end()
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, DELETE')
    return res.status(405).end()
  }
  if (!attempts('login').ok) return back('busy')
  if (!passwordMatches(req.body?.password, process.env.ILLUS_LOGIN_PASSWORD)) return back('password')

  res.setHeader('Set-Cookie', config.s.issueSession({ sub: config.allowedSub }))
  return res.redirect(303, safeNext(req.body?.next))
}
