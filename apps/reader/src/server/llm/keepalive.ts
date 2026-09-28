import type { ServerResponse } from 'node:http'

export const KEEPALIVE_AFTER_MS = 10_000
export const KEEPALIVE_EVERY_MS = 15_000

/** Sends final JSON, with early 200 headers and whitespace for slow calls (ADR 0051).
 * Once headers are sent, the body's `ok`/`code` carry the gateway outcome. */
export async function respondWithKeepAlive(
  res: ServerResponse,
  pending: Promise<{ status: number; body: unknown }>,
  o: { afterMs?: number; everyMs?: number } = {},
): Promise<void> {
  let closed = false
  let tick: ReturnType<typeof setInterval> | undefined
  let start: ReturnType<typeof setTimeout> | undefined
  const unavailable = () => closed || res.writableEnded || res.destroyed
  const clearTimers = () => {
    clearTimeout(start)
    clearInterval(tick)
  }
  const onClose = () => {
    closed = true
    clearTimers()
  }
  res.once('close', onClose)
  if (!unavailable()) {
    start = setTimeout(() => {
      if (unavailable()) return
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.flushHeaders()
      res.write(' ')
      tick = setInterval(() => {
        if (unavailable()) {
          clearTimers()
          return
        }
        res.write(' ')
      }, o.everyMs ?? KEEPALIVE_EVERY_MS)
    }, o.afterMs ?? KEEPALIVE_AFTER_MS)
  }

  try {
    const result = await pending
    if (unavailable()) return
    if (!res.headersSent) {
      res.statusCode = result.status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
    }
    res.end(JSON.stringify(result.body))
  } finally {
    clearTimers()
    res.removeListener('close', onClose)
  }
}
