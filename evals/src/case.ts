// Golden case format (§18) and the CaseRun a runner returns for one case (replay recording or live run).
import { BlockKind, CriticReport, ReasoningEffort, RoleName, VisualKind } from '@illus/core'
import { z } from 'zod'

export const EvalCategory = z.enum(['architecture', 'protocol', 'state', 'data-structure', 'algorithmic', 'math', 'narrative'])
export type EvalCategory = z.infer<typeof EvalCategory>

/**
 * One golden section (§18): expected `needsVisual`, acceptable kinds, `mustInclude` / `mustNotInclude`
 * terms and, for traces, the expected final return value.
 *
 * `bookRef`: `synthetic` (fixtures/books/synthetic.epub), `small-book` (@illus/core/testing),
 * `eval-mini` (evals/src/books/eval-mini.ts) or `private:<file>` (fixtures/books/private/, local only).
 */
export const EvalCase = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    category: EvalCategory,
    bookRef: z.string().regex(/^(synthetic|small-book|eval-mini|private:.+)$/),
    sectionId: z.string().min(1),
    title: z.string().min(1),
    expected: z.object({
      needsVisual: z.boolean(),
      acceptableKinds: z.array(VisualKind),
      mustInclude: z.array(z.string().min(1)),
      mustNotInclude: z.array(z.string().min(1)),
      /** Python `repr` of the traced function's final return value (first executed scenario). */
      trace: z.object({ expectedReturn: z.string() }).optional(),
    }),
    /** `golden` (hand-picked) or `regression` (exported from reader feedback, §16 L6). */
    source: z.enum(['golden', 'regression']),
    notes: z.string().optional(),
  })
  .refine((c) => !c.expected.needsVisual || c.expected.acceptableKinds.length > 0, {
    message: 'cases that need a visual list acceptable kinds',
  })
export type EvalCase = z.infer<typeof EvalCase>

/** A context block as the run saw it (the eval only needs id, kind and text). */
export const RunBlock = z.object({ blockId: z.string().min(1), kind: BlockKind, text: z.string() })
export type RunBlock = z.infer<typeof RunBlock>

export const RunVisual = z.object({
  planItemId: z.string().min(1),
  kind: VisualKind,
  /** Raw model outputs in order (first extraction, re-extraction, repair…); the last one is shown. */
  attempts: z.array(z.unknown()),
  critic: CriticReport.optional(),
  /** Trace visuals: how the code ran and the first scenario's final return value (Python repr). */
  trace: z.object({ mode: z.enum(['executed', 'simulated']), returnValue: z.string().nullable() }).optional(),
  /** Why the item produced no visual (`item-failed` code and message), when it failed. */
  failure: z.string().optional(),
  /** Concept-model visuals: mean node displacement from the previous section, in px (§13). */
  displacementPx: z.number().nonnegative().optional(),
})
export type RunVisual = z.infer<typeof RunVisual>

export const RunCall = z.object({
  role: RoleName,
  model: z.string().min(1),
  effort: ReasoningEffort,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),
})
export type RunCall = z.infer<typeof RunCall>

/** Everything the metrics need from one case run. Replay files under `evals/replay/` hold exactly this. */
export const CaseRun = z.object({
  caseId: z.string().min(1),
  /** `handwritten` fixtures (CLAUDE.md rule 6) or `recorded` from a live run. */
  source: z.enum(['handwritten', 'recorded']),
  /** The permitted blocks (`usedBlockIds`) of the packed context. */
  blocks: z.array(RunBlock),
  /** Glossary canonical name → aliases, for the relevance check. */
  aliases: z.record(z.string(), z.array(z.string())).optional(),
  /** Raw planner outputs in order (parsed by the harness, so schema failures are measured); the last is used. */
  planAttempts: z.array(z.unknown()).min(1),
  visuals: z.array(RunVisual),
  calls: z.array(RunCall),
  /** Latency path (§15): `no-visual`, `static`, `animated`, `trace`, `cache-hit`. */
  path: z.string().min(1),
  latencyMs: z.number().nonnegative(),
  /** What this runner cannot measure (the Node live runner has no Pyodide worker and no renderer). */
  unsupported: z.array(z.enum(['trace', 'critic'])).optional(),
})
export type CaseRun = z.infer<typeof CaseRun>
