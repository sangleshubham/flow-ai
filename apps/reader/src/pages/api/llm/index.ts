// POST /api/llm (spec §9): adapts Next.js req/res to the framework-free gateway in @illus/llm/server.
import type { NextApiRequest, NextApiResponse } from 'next'

import { getIllusServer } from '../../../server/llm'
import { respondWithKeepAlive } from '../../../server/llm/keepalive'

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } } // critic PNGs arrive as base64

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Prevent Next's compression middleware from buffering keep-alive bytes.
  res.setHeader('Cache-Control', 'no-store, no-transform')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res
      .status(405)
      .json({ ok: false, code: 'upstream', message: 'POST only' })
  }
  let server
  try {
    server = await getIllusServer()
  } catch (e) {
    return res.status(500).json({
      ok: false,
      code: 'upstream',
      message: `LLM gateway is misconfigured: ${(e as Error).message}`,
    })
  }
  // A client that disconnects no longer wants the result; stop the upstream call.
  const abort = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) abort.abort()
  })
  const sub = server.sessions.verify(req.headers.cookie)?.sub ?? null
  await respondWithKeepAlive(
    res,
    server.gateway.handle(req.body, {
      sub,
      signal: abort.signal,
      ...(req.headers['x-illus-recheck-plan-limit'] === '1' && {
        recheckPlanLimit: true,
      }),
    }),
  )
}
