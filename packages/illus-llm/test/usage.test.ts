import { expect, it } from 'vitest'

import { createUsageTracker, openReaderDb } from '../src/server/index.ts'
import type { UsageRow } from '../src/server/index.ts'

it('counts each user separately, keeps pauses across tracker restarts, and expires rolling windows', async () => {
  const db = openReaderDb({ memory: true })
  let t = 100_000_000
  const tracker = createUsageTracker({ db, now: () => t })
  const row: UsageRow = {
    sub: 'A',
    ts: t,
    requestId: 'r',
    role: 'planner',
    provider: 'chatgpt-plan',
    mode: 'live',
    model: 'm',
    effort: 'low',
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    latencyMs: 1,
    outcome: 'ok',
    attempts: 500,
  }
  await tracker.forUser('A').append(row)
  expect(tracker.forUser('A').summary()).toEqual({
    used5h: 500,
    usedDay: 500,
    pausedUntil: null,
  })
  expect(tracker.forUser('B').summary().usedDay).toBe(0)
  await expect(tracker.forUser('B').append(row)).rejects.toThrow(/account/)
  tracker.forUser('A').pause(t + 10_000)
  tracker.forUser('A').pause(t + 5_000)
  const restarted = createUsageTracker({ db, now: () => t })
  expect(restarted.forUser('A').pausedUntil()).toBe(t + 10_000)
  expect(restarted.forUser('B').pausedUntil()).toBeNull()
  t += 6 * 3_600_000
  expect(restarted.forUser('A').summary()).toEqual({
    used5h: 0,
    usedDay: 500,
    pausedUntil: null,
  })
  t += 24 * 3_600_000
  expect(restarted.forUser('A').summary().usedDay).toBe(0)
  db.close()
})
