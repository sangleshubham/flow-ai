// Plan usage controls (§9 steps 3 and 8, §15): `usage.jsonl`, local soft caps over a rolling 5-hour
// window and a rolling 24-hour day, and the pause after a ChatGPT plan-limit 429.
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { LlmOutcome, ReasoningEffort, RoleName } from '@illus/core'

const HOUR = 3_600_000
const WINDOW_5H = 5 * HOUR
const DAY = 24 * HOUR
/** Pause when a plan-limit 429 gives no reset time (ADR 0007): OpenAI says not to infer one. */
export const DEFAULT_PLAN_PAUSE_MS = 30 * 60_000

/** One line of `${ILLUS_DATA_DIR}/usage.jsonl` (§9 step 8). No dollar figures. */
export interface UsageRow {
  ts: number
  requestId: string
  role: RoleName
  provider: string
  mode: 'live' | 'record' | 'replay'
  model: string
  effort: ReasoningEffort | ''
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  latencyMs: number
  outcome: LlmOutcome
  /** Upstream requests made (retries and fallbacks included); what the caps count. */
  attempts: number
}

export interface UsageCaps {
  max5h: number
  maxDay: number
}

/** Starting values (ADR 0007), tuned after the M1 eval. */
export const DEFAULT_CAPS: UsageCaps = { max5h: 100, maxDay: 300 }

export interface UsageSummary {
  used5h: number
  usedDay: number
  max5h: number
  maxDay: number
  /** Epoch ms until which plan requests are paused after a plan-limit 429. */
  pausedUntil: number | null
}

export interface UsageTracker {
  /** Upstream requests still allowed now (min of both windows); 0 means over a cap. */
  remaining(): number
  /** Counts one upstream request (call before each attempt). */
  countAttempt(): void
  pausedUntil(): number | null
  pause(untilMs: number): void
  append(row: UsageRow): Promise<void>
  summary(): UsageSummary
}

/**
 * Usage tracker over `usage.jsonl`. Attempts from the last 24 h are re-read at start so a restart does
 * not reset the caps.
 */
export async function createUsageTracker(o: { file: string; caps: UsageCaps; now?: () => number }): Promise<UsageTracker> {
  const now = o.now ?? Date.now
  // ponytail: in-memory list of attempt timestamps (≤ maxDay entries live); fine for one user.
  let attempts: number[] = []
  let pausedUntil: number | null = null
  try {
    const since = now() - DAY
    for (const line of (await readFile(o.file, 'utf8')).split('\n')) {
      if (!line.trim()) continue
      try {
        const row = JSON.parse(line) as Partial<UsageRow>
        if (typeof row.ts === 'number' && row.ts >= since) for (let i = 0; i < (row.attempts ?? 0); i++) attempts.push(row.ts)
      } catch {
        // skip a torn line
      }
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  const prune = () => {
    const t = now()
    attempts = attempts.filter((a) => a > t - DAY)
    if (pausedUntil !== null && pausedUntil <= t) pausedUntil = null
    return t
  }
  const counts = () => {
    const t = prune()
    return { used5h: attempts.filter((a) => a > t - WINDOW_5H).length, usedDay: attempts.length }
  }
  return {
    remaining() {
      const c = counts()
      return Math.max(0, Math.min(o.caps.max5h - c.used5h, o.caps.maxDay - c.usedDay))
    },
    countAttempt: () => void attempts.push(now()),
    pausedUntil: () => (prune(), pausedUntil),
    pause(until) {
      pausedUntil = Math.max(pausedUntil ?? 0, until)
    },
    async append(row) {
      await mkdir(dirname(o.file), { recursive: true })
      await appendFile(o.file, JSON.stringify(row) + '\n', { mode: 0o600 })
    },
    summary() {
      const c = counts()
      return { ...c, max5h: o.caps.max5h, maxDay: o.caps.maxDay, pausedUntil }
    },
  }
}

/** Reads a positive integer env value, or the default. */
export function capFromEnv(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return value?.trim() && Number.isInteger(n) && n > 0 ? n : fallback
}
