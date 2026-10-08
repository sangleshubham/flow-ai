// Validation and critic reports (§16).
import { z } from 'zod'

/** Validation layer that raised an issue (§16 table: L1 schema … L4 render; animation is §11). */
export const ValidationLayer = z.enum(['schema', 'grounding', 'structure', 'render', 'animation'])
export type ValidationLayer = z.infer<typeof ValidationLayer>

export const ValidationIssue = z.object({
  layer: ValidationLayer,
  severity: z.enum(['error', 'warning']),
  /** Stable machine-readable code, e.g. 'edge-endpoint-missing', 'quote-not-found', 'dropped'. */
  code: z.string().min(1),
  message: z.string().min(1),
  /** IR element id (or template element path) the issue is about. */
  elementId: z.string().min(1).optional(),
  /** The validator fixed it deterministically (§16 L3 "auto-fix where safe"). */
  autoFixed: z.boolean().optional(),
})
export type ValidationIssue = z.infer<typeof ValidationIssue>

/**
 * Outcome of the deterministic checks on one IR (§16 L1–L4). Not defined in the spec; W0 draft.
 * `groundingScore` = (grounded + 0.5 × halfGrounded) / total (§16).
 */
export const ValidationReport = z.object({
  ok: z.boolean(),
  groundingScore: z.number().min(0).max(1),
  counts: z.object({
    total: z.number().int().nonnegative(),
    grounded: z.number().int().nonnegative(),
    halfGrounded: z.number().int().nonnegative(),
    fuzzy: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
  }),
  /** Ids of elements removed because their evidence failed or they dangled. */
  dropped: z.array(z.string().min(1)),
  issues: z.array(ValidationIssue),
  /** The extractor was re-run once with this report attached (§8 stage 3 step 3). */
  retried: z.boolean(),
  /** The model tier was escalated once (§8, §9). */
  escalated: z.boolean(),
})
export type ValidationReport = z.infer<typeof ValidationReport>

const Score = z.literal([1, 2, 3, 4, 5])

/** Output of the `critic` role (§16). */
export const CriticReport = z.object({
  pass: z.boolean(),
  scores: z.object({ legibility: Score, intentMatch: Score, clutter: Score }),
  issues: z.array(
    z.object({
      elementId: z.string().min(1).optional(),
      kind: z.enum(['overlap', 'unreadable', 'missing-step', 'wrong-direction', 'mislabel', 'clutter', 'other']),
      note: z.string().min(1),
    }),
  ),
})
export type CriticReport = z.infer<typeof CriticReport>

/** §16 pass rule: every score ≥ 3 and no `wrong-direction` or `mislabel` issue. */
export function criticPasses(report: Pick<CriticReport, 'scores' | 'issues'>): boolean {
  const { legibility, intentMatch, clutter } = report.scores
  return (
    legibility >= 3 &&
    intentMatch >= 3 &&
    clutter >= 3 &&
    !report.issues.some((i) => i.kind === 'wrong-direction' || i.kind === 'mislabel')
  )
}
