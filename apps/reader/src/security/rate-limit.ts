// In-memory token bucket (spec §17: `/api/llm` allows 60 requests per minute per session).
// Runs in both the Edge middleware and Node API routes, so it uses no Node APIs.
// ponytail: per-process memory; a restart resets every bucket, fine for one user and one container.

export interface RateLimitResult {
  ok: boolean
  /** Milliseconds until one token is available again (only when refused). */
  retryAfterMs?: number
}

export interface RateLimiter {
  (key: string): RateLimitResult
  size(): number
}

export function createRateLimiter(o: { capacity: number; perMs: number; now?: () => number }): RateLimiter {
  const now = o.now ?? Date.now
  const msPerToken = o.perMs / o.capacity
  const buckets = new Map<string, { tokens: number; at: number }>()
  let lastSweep = now()

  const refill = (b: { tokens: number; at: number }, t: number) => {
    b.tokens = Math.min(o.capacity, b.tokens + (t - b.at) / msPerToken)
    b.at = t
  }

  const limit = ((key: string) => {
    const t = now()
    if (t - lastSweep >= o.perMs) {
      // Full buckets carry no information; drop them.
      for (const [k, b] of buckets) {
        refill(b, t)
        if (b.tokens >= o.capacity) buckets.delete(k)
      }
      lastSweep = t
    }
    const b = buckets.get(key) ?? { tokens: o.capacity, at: t }
    refill(b, t)
    buckets.set(key, b)
    if (b.tokens >= 1) {
      b.tokens -= 1
      return { ok: true }
    }
    return { ok: false, retryAfterMs: Math.ceil((1 - b.tokens) * msPerToken) }
  }) as RateLimiter
  limit.size = () => buckets.size
  return limit
}
