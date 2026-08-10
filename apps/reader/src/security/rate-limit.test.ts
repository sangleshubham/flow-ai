import { describe, expect, it } from 'vitest'

import { createRateLimiter } from './rate-limit'

describe('createRateLimiter (token bucket)', () => {
  it('allows 60 requests per minute per key, then refuses with a retry delay', () => {
    const t = 0
    const limit = createRateLimiter({ capacity: 60, perMs: 60_000, now: () => t })
    for (let i = 0; i < 60; i++) expect(limit('a').ok).toBe(true)
    const refused = limit('a')
    expect(refused.ok).toBe(false)
    expect(refused.retryAfterMs).toBe(1000)
    // Another session has its own bucket.
    expect(limit('b').ok).toBe(true)
  })

  it('refills one token per second up to capacity', () => {
    let t = 0
    const limit = createRateLimiter({ capacity: 60, perMs: 60_000, now: () => t })
    for (let i = 0; i < 60; i++) limit('a')
    t += 1000
    expect(limit('a').ok).toBe(true)
    expect(limit('a').ok).toBe(false)
    t += 10 * 60_000
    for (let i = 0; i < 60; i++) expect(limit('a').ok).toBe(true)
    expect(limit('a').ok).toBe(false)
  })

  it('forgets idle full buckets so memory stays bounded', () => {
    let t = 0
    const limit = createRateLimiter({ capacity: 2, perMs: 1000, now: () => t })
    for (let i = 0; i < 5000; i++) limit(`k${i}`)
    t += 10_000
    limit('trigger')
    expect(limit.size()).toBeLessThan(10)
  })
})
