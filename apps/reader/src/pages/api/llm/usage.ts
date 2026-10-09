// GET /api/llm/usage: requests used against the local soft caps and any plan-limit pause (spec §15
// "the pane shows usage against them"). Session required.
import type { NextApiRequest, NextApiResponse } from 'next'

import { getIllusServer } from '../../../server/llm'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).end()
  const server = await getIllusServer()
  if (!server.sessions.verify(req.headers.cookie)) return res.status(401).json({ ok: false, code: 'auth', message: 'sign in first' })
  res.status(200).json({ ok: true, mode: server.mode, provider: server.provider, ...server.usage.summary() })
}
