// Per-user usage records and the pause after an upstream ChatGPT plan limit (ADR 0055).
import type { LlmOutcome, ReasoningEffort, RoleName } from '@illus/core'

import type { ReaderDb } from './db.ts'

const HOUR = 3_600_000
export const DEFAULT_PLAN_PAUSE_MS = 30 * 60_000

export interface UsageRow {
  sub: string
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
  /** Upstream requests made (retries and fallbacks included); recorded per user. */
  attempts: number
  /** Safe upstream diagnostics; never stores credentials, request bodies, or book text. */
  upstreamError?: {
    status?: number
    code?: string
    param?: string
    requestId?: string
  }
}

export interface UsageSummary {
  used5h: number
  usedDay: number
  pausedUntil: number | null
}

export interface UserUsage {
  pausedUntil(): number | null
  pause(untilMs: number): void
  /** Clear the pause that a completed access check actually observed, preserving newer failures. */
  resume(expectedUntil: number): void
  append(row: UsageRow): Promise<void>
  summary(): UsageSummary
}

export interface UsageTracker {
  forUser(sub: string): UserUsage
}

export function createUsageTracker(o: {
  db: ReaderDb
  now?: () => number
}): UsageTracker {
  const now = o.now ?? Date.now
  const sum = o.db.prepare(
    'SELECT COALESCE(SUM(attempts),0) AS n FROM usage WHERE sub=? AND ts>?',
  )
  return {
    forUser(sub) {
      if (!sub) throw new Error('usage requires an account')
      const pausedUntil = () => {
        const until = Number(
          o.db
            .prepare('SELECT paused_until FROM usage_pause WHERE sub=?')
            .get(sub)?.paused_until ?? 0,
        )
        return until > now() ? until : null
      }
      return {
        pausedUntil,
        pause(until) {
          if (!Number.isFinite(until))
            throw new Error('invalid plan reset time')
          o.db
            .prepare(
              `INSERT INTO usage_pause(sub,paused_until) VALUES(?,?)
            ON CONFLICT(sub) DO UPDATE SET paused_until=MAX(paused_until,excluded.paused_until)`,
            )
            .run(sub, until)
        },
        resume(expectedUntil) {
          o.db
            .prepare('DELETE FROM usage_pause WHERE sub=? AND paused_until=?')
            .run(sub, expectedUntil)
        },
        async append(row) {
          if (row.sub !== sub) throw new Error('usage account mismatch')
          o.db
            .prepare('INSERT INTO usage(sub,ts,attempts,row) VALUES(?,?,?,?)')
            .run(sub, row.ts, row.attempts, JSON.stringify(row))
        },
        summary() {
          const t = now()
          return {
            used5h: Number(sum.get(sub, t - 5 * HOUR)!.n),
            usedDay: Number(sum.get(sub, t - 24 * HOUR)!.n),
            pausedUntil: pausedUntil(),
          }
        },
      }
    },
  }
}
