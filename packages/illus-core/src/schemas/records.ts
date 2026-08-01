// Cache and log records of the IndexedDB stores that are not defined elsewhere (§5, §9, §15, §16).
import { z } from 'zod'

import { Evidence, ReasoningEffort, Timestamp } from './common.ts'
import { AnimationIR } from './animation.ts'
import { LlmErrorCode, RoleName } from './llm.ts'
import { VisualKind } from './plan.ts'
import { CriticReport, ValidationReport } from './quality.ts'

/** Element-level "This is wrong" report from the pane (§16 human feedback). */
export const ElementReport = z.object({
  elementId: z.string().min(1),
  evidence: Evidence.optional(),
  note: z.string(),
  createdAt: Timestamp,
})
export type ElementReport = z.infer<typeof ElementReport>

/** Record of the `visuals` store (§5), keyed by the visual cache key. */
export const VisualRecord = z.object({
  cacheKey: z.string().min(1),
  bookId: z.string().min(1),
  sectionId: z.string().min(1),
  planItemId: z.string().min(1),
  kind: VisualKind,
  /** The validated IR (`IR`), or `null` for `trace` visuals, which point at `traceKey`. */
  ir: z.unknown(),
  /**
   * For IR kinds: `null`, or the IR again. `@illus/render` turns the validated IR into engine input
   * itself (v1.1, ADR 0008); the graph layout is cached in `layout`. Template and HTML kinds keep
   * whatever their renderer needs.
   */
  spec: z.unknown(),
  animation: AnimationIR.optional(),
  traceKey: z.string().min(1).optional(),
  /** Cached graph layout (ELK result) so revisits skip layout (§10); written from the renderer's `onLayout`. */
  layout: z.unknown().optional(),
  validation: ValidationReport,
  critic: CriticReport.optional(),
  /** Role → prompt version used. */
  promptVersions: z.record(z.string(), z.string()),
  /** Role → `model@effort` actually used (§9: both are part of the cache key). */
  models: z.record(z.string(), z.string()),
  usageTokens: z.number().int().nonnegative(),
  createdAt: Timestamp,
  stale: z.boolean(),
  /** The reader pinned it; pinned records are evicted last (§14, §15). */
  pinned: z.boolean().optional(),
  /** "Regenerate with instruction" text, ≤ 300 characters (§8). */
  instruction: z.string().max(300).optional(),
  feedback: z.object({ vote: z.enum(['up', 'down']), note: z.string().optional() }).optional(),
  elementReports: z.array(ElementReport).optional(),
})
export type VisualRecord = z.infer<typeof VisualRecord>

/** Outcome of one model call: `ok` or the gateway error code (§9). */
export const LlmOutcome = z.union([z.literal('ok'), LlmErrorCode, z.literal('aborted')])
export type LlmOutcome = z.infer<typeof LlmOutcome>

/** Row of the `llmLog` store (§9 client): one per call. Prompts only when `debugPrompts` is on. */
export const LlmLogEntry = z.object({
  /** Auto-increment key; absent until stored. */
  id: z.number().int().positive().optional(),
  requestId: z.string().min(1),
  role: RoleName,
  promptVersion: z.string().min(1),
  model: z.string(),
  effort: ReasoningEffort,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),
  outcome: LlmOutcome,
  bookId: z.string().min(1).optional(),
  sectionId: z.string().min(1).optional(),
  prompt: z.object({ prefix: z.string(), body: z.string() }).optional(),
  createdAt: Timestamp,
})
export type LlmLogEntry = z.infer<typeof LlmLogEntry>

/** Row of the `settings` store (§5): a key and a JSON value. */
export const SettingRecord = z.object({
  key: z.string().min(1),
  value: z.unknown(),
})
export type SettingRecord = z.infer<typeof SettingRecord>
