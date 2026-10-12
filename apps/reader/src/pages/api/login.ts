// Password access to the known owner; creates the same revocable session as ChatGPT sign-in.
import type { NextApiRequest, NextApiResponse } from 'next'

import { passwordMatches, safeNext } from '../../security/login'
import { createRateLimiter } from '../../security/rate-limit'
import { getIllusServer } from '../../server/llm'

const attempts = createRateLimiter({ capacity: 5, perMs: 60_000 })

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader('Cache-Control', 'no-store')
  const back = (error: string) =>
    res.redirect(
      303,
      `/login?error=${error}&next=${encodeURIComponent(
        safeNext(req.body?.next),
      )}`,
    )
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE')
    return res.status(405).end()
  }
  if (req.method === 'POST') {
    if (!attempts('login').ok) return back('busy')
    if (!passwordMatches(req.body?.password, process.env.ILLUS_LOGIN_PASSWORD))
      return back('password')
  }
  let server
  try {
    server = await getIllusServer()
  } catch {
    return back('config')
  }
  if (req.method === 'DELETE') {
    const session = server.sessions.verify(req.headers.cookie)
    if (session) server.sessions.revoke(session.sid)
    res.setHeader('Set-Cookie', server.sessions.clearCookie())
    return res.status(204).end()
  }
  const sub = await server.ownerSub()
  if (!sub) return back('config')
  res.setHeader('Set-Cookie', server.sessions.issueSession({ sub }))
  return res.redirect(303, safeNext(req.body?.next))
}
