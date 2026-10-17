// GET /api/llm/usage: per-user counts and upstream plan-limit pause (ADR 0055).
import type { NextApiRequest, NextApiResponse } from 'next'

import { getIllusServer } from '../../../server/llm'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).end()
  const server = await getIllusServer()
  const session = server.sessions.verify(req.headers.cookie)
  if (!session)
    return res
      .status(401)
      .json({ ok: false, code: 'auth', message: 'sign in first' })
  res
    .status(200)
    .json({
      ok: true,
      mode: server.mode,
      provider: server.provider,
      ...server.usage.forUser(session.sub).summary(),
    })
}
