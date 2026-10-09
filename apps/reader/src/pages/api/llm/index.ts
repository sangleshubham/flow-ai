// POST /api/llm (spec §9): adapts Next.js req/res to the framework-free gateway in @illus/llm/server.
import type { NextApiRequest, NextApiResponse } from 'next'

import { getIllusServer } from '../../../server/llm'

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } } // critic PNGs arrive as base64

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, code: 'upstream', message: 'POST only' })
  }
  let server
  try {
    server = await getIllusServer()
  } catch (e) {
    return res.status(500).json({ ok: false, code: 'upstream', message: `LLM gateway is misconfigured: ${(e as Error).message}` })
  }
  // A client that disconnects no longer wants the result; stop the upstream call.
  const abort = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) abort.abort()
  })
  const session = server.sessions.verify(req.headers.cookie) !== null
  const result = await server.gateway.handle(req.body, { session, signal: abort.signal })
  res.status(result.status).json(result.body)
}
