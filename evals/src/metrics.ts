// Per-case scoring and the §18 metrics with their v1 thresholds. Pure: no I/O.
import { criticPasses, ground, normalizeText, Translation, validate, VisualPlan } from '@illus/core'
import type { Block, VisualKind } from '@illus/core'

import type { CaseRun, EvalCase } from './case.ts'

export type MetricKey =
  | 'needsVisualAccuracy'
  | 'kindAccuracy'
  | 'schemaFirstAttempt'
  | 'meanGrounding'
  | 'mustIncludeRecall'
  | 'mustNotIncludeViolations'
  | 'criticPassRate'
  | 'traceCorrect'
  | 'displacementPx'

export interface Threshold {
  key: MetricKey
  label: string
  op: '>=' | '<='
  value: number
  /** Shown as a percentage. */
  percent?: boolean
}

/** §18 "Metrics and v1 thresholds". */
export const THRESHOLDS: readonly Threshold[] = [
  { key: 'needsVisualAccuracy', label: '`needsVisual` accuracy', op: '>=', value: 0.9, percent: true },
  { key: 'kindAccuracy', label: 'Plan kind in acceptable set', op: '>=', value: 0.85, percent: true },
  { key: 'schemaFirstAttempt', label: 'Schema valid on first attempt', op: '>=', value: 0.95, percent: true },
  { key: 'meanGrounding', label: 'Mean grounding score', op: '>=', value: 0.9 },
  { key: 'mustIncludeRecall', label: '`mustInclude` recall', op: '>=', value: 0.8 },
  { key: 'mustNotIncludeViolations', label: '`mustNotInclude` violations', op: '<=', value: 0 },
  { key: 'criticPassRate', label: 'Critic pass rate', op: '>=', value: 0.85, percent: true },
  { key: 'traceCorrect', label: 'Trace cases executed with correct return value', op: '>=', value: 0.8, percent: true },
  { key: 'displacementPx', label: 'Concept-model node displacement (mean px)', op: '<=', value: 40 },
]

export interface CaseResult {
  caseId: string
  category: string
  status: 'pass' | 'fail' | 'skipped'
  reasons: string[]
  needsVisual: { expected: boolean; actual: boolean | null }
  /** Kind of the priority-1 item and whether it is acceptable; null when not applicable. */
  kind: { actual: VisualKind | null; ok: boolean | null }
  schema: { checked: number; firstValid: number }
  /** Grounding score of each IR visual (after validation). */
  grounding: number[]
  mustInclude: { found: string[]; missing: string[] }
  violations: string[]
  critic: { checked: number; passed: number }
  trace: { ok: boolean | null; detail?: string }
  displacement: number[]
  tokens: { input: number; output: number }
  path: string | null
  latencyMs: number | null
}

const ID_KEYS = new Set([
  'evidence', 'id', 'from', 'to', 'lane', 'group', 'parent', 'initial', 'final', 'type', 'templateId',
  'sourceBlockId', 'path', 'shape', 'kind', 'style', 'direction', 'visibility', 'key', 'identifying', 'simulated',
])

/** Displayed text of an IR: every string or number leaf except evidence and structural ids. */
function displayedText(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string' || typeof value === 'number') out.push(String(value))
  else if (Array.isArray(value)) value.forEach((v) => displayedText(v, out))
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) if (!ID_KEYS.has(k)) displayedText(v, out)
  return out
}

const contains = (haystack: string, term: string) => haystack.includes(normalizeText(term).text)

function toBlocks(c: EvalCase, run: CaseRun): Map<string, Block> {
  return new Map(
    run.blocks.map((b) => [b.blockId, { ...b, sectionId: c.sectionId, cfiRange: 'epubcfi(/0)' } as Block]),
  )
}

function empty(c: EvalCase): CaseResult {
  return {
    caseId: c.id,
    category: c.category,
    status: 'fail',
    reasons: [],
    needsVisual: { expected: c.expected.needsVisual, actual: null },
    kind: { actual: null, ok: null },
    schema: { checked: 0, firstValid: 0 },
    grounding: [],
    mustInclude: { found: [], missing: [] },
    violations: [],
    critic: { checked: 0, passed: 0 },
    trace: { ok: null },
    displacement: [],
    tokens: { input: 0, output: 0 },
    path: null,
    latencyMs: null,
  }
}

/** Scores one case. `run` is null when no recording exists; private-book cases are then skipped. */
export function scoreCase(c: EvalCase, run: CaseRun | null): CaseResult {
  const r = empty(c)
  if (!run) {
    r.status = c.bookRef.startsWith('private:') ? 'skipped' : 'fail'
    r.reasons.push(r.status === 'skipped' ? 'private book not available here' : 'no run (missing recording)')
    return r
  }
  r.path = run.path
  r.latencyMs = run.latencyMs
  for (const call of run.calls) {
    r.tokens.input += call.inputTokens
    r.tokens.output += call.outputTokens
  }

  // Plan: first attempt for the schema metric, last attempt for the decision.
  r.schema.checked++
  if (VisualPlan.safeParse(run.planAttempts[0]).success) r.schema.firstValid++
  const plan = VisualPlan.safeParse(run.planAttempts.at(-1))
  if (!plan.success) r.reasons.push('plan does not parse')
  else {
    r.needsVisual.actual = plan.data.needsVisual
    if (plan.data.needsVisual !== c.expected.needsVisual) r.reasons.push(`needsVisual ${plan.data.needsVisual}, expected ${c.expected.needsVisual}`)
    const first = [...plan.data.items].sort((a, b) => a.priority - b.priority)[0]
    if (c.expected.needsVisual) {
      r.kind.actual = first?.kind ?? null
      r.kind.ok = first !== undefined && c.expected.acceptableKinds.includes(first.kind)
      if (!r.kind.ok) r.reasons.push(`kind ${first?.kind ?? 'none'} not in [${c.expected.acceptableKinds.join(', ')}]`)
    }
  }

  // Visuals: schema of the first attempt, validation (grounding) of the last.
  const blocks = toBlocks(c, run)
  const aliases = run.aliases ? new Map(Object.entries(run.aliases)) : undefined
  const shown: string[] = []
  for (const v of run.visuals) {
    if (v.kind === 'trace') {
      if (v.attempts.length) {
        r.schema.checked++
        if (Translation.safeParse(v.attempts[0]).success) r.schema.firstValid++
      }
      const want = c.expected.trace?.expectedReturn
      if (want !== undefined) {
        r.trace.ok = v.trace?.mode === 'executed' && v.trace.returnValue === want
        r.trace.detail = `${v.trace?.mode ?? 'no trace'}, returned ${v.trace?.returnValue ?? 'nothing'}; expected ${want}`
        if (!r.trace.ok) r.reasons.push(`trace: ${r.trace.detail}`)
      }
      if (v.trace?.returnValue) shown.push(v.trace.returnValue)
    } else if (v.attempts.length) {
      r.schema.checked++
      const firstReport = validate(v.kind, v.attempts[0], { blocks, ground, aliases }).report
      if (!firstReport.issues.some((i) => i.layer === 'schema')) r.schema.firstValid++
      const { ir, report } = validate(v.kind, v.attempts.at(-1), { blocks, ground, aliases })
      if (v.kind !== 'html') r.grounding.push(report.groundingScore)
      if (report.issues.some((i) => i.layer === 'schema')) r.reasons.push(`${v.planItemId}: final ${v.kind} IR does not parse`)
      else shown.push(...displayedText(ir))
    }
    if (v.critic) {
      r.critic.checked++
      if (criticPasses(v.critic)) r.critic.passed++
      else r.reasons.push(`${v.planItemId}: critic failed`)
    }
    if (v.displacementPx !== undefined) r.displacement.push(v.displacementPx)
  }
  if (c.expected.trace && r.trace.ok === null) {
    r.trace.ok = false
    r.reasons.push('trace: no trace visual')
  }

  const text = normalizeText(shown.join(' • ')).text
  if (c.expected.needsVisual)
    for (const t of c.expected.mustInclude) (contains(text, t) ? r.mustInclude.found : r.mustInclude.missing).push(t)
  r.violations = c.expected.mustNotInclude.filter((t) => contains(text, t))
  if (r.mustInclude.missing.length) r.reasons.push(`missing terms: ${r.mustInclude.missing.join(', ')}`)
  if (r.violations.length) r.reasons.push(`forbidden terms: ${r.violations.join(', ')}`)
  const low = r.grounding.filter((g) => g < 0.9)
  if (low.length) r.reasons.push(`grounding below 0.90: ${low.map((g) => g.toFixed(2)).join(', ')}`)

  r.status = r.reasons.length ? 'fail' : 'pass'
  return r
}

const ratio = (num: number, den: number) => (den === 0 ? null : num / den)
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** Nearest-rank percentile of a non-empty list. */
export function percentile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!
}

export interface Summary {
  metrics: Record<MetricKey, number | null>
  cases: { total: number; passed: number; failed: number; skipped: number }
  tokens: { input: number; output: number }
  latency: Record<string, { n: number; p50: number; p95: number }>
}

/** Aggregates case results into the §18 metrics (null = not applicable to this set). */
export function summarize(results: readonly CaseResult[]): Summary {
  const scored = results.filter((r) => r.status !== 'skipped')
  const visualCases = scored.filter((r) => r.needsVisual.expected)
  const traced = scored.filter((r) => r.trace.ok !== null)
  const sum = (f: (r: CaseResult) => number) => scored.reduce((n, r) => n + f(r), 0)

  const latency: Summary['latency'] = {}
  const byPath = new Map<string, number[]>()
  for (const r of scored) if (r.path && r.latencyMs !== null) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r.latencyMs])
  for (const [path, xs] of [...byPath].sort()) latency[path] = { n: xs.length, p50: percentile(xs, 50), p95: percentile(xs, 95) }

  return {
    metrics: {
      // A missing run or an unparseable plan counts as wrong.
      needsVisualAccuracy: ratio(scored.filter((r) => r.needsVisual.actual === r.needsVisual.expected).length, scored.length),
      kindAccuracy: ratio(visualCases.filter((r) => r.kind.ok).length, visualCases.length),
      schemaFirstAttempt: ratio(sum((r) => r.schema.firstValid), sum((r) => r.schema.checked)),
      meanGrounding: mean(scored.flatMap((r) => r.grounding)),
      mustIncludeRecall: ratio(sum((r) => r.mustInclude.found.length), sum((r) => r.mustInclude.found.length + r.mustInclude.missing.length)),
      mustNotIncludeViolations: scored.length ? sum((r) => r.violations.length) : null,
      criticPassRate: ratio(sum((r) => r.critic.passed), sum((r) => r.critic.checked)),
      traceCorrect: ratio(traced.filter((r) => r.trace.ok).length, traced.length),
      displacementPx: mean(scored.flatMap((r) => r.displacement)),
    },
    cases: {
      total: results.length,
      passed: results.filter((r) => r.status === 'pass').length,
      failed: results.filter((r) => r.status === 'fail').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
    },
    tokens: { input: sum((r) => r.tokens.input), output: sum((r) => r.tokens.output) },
    latency,
  }
}

export type ThresholdStatus = 'pass' | 'fail' | 'n/a'

export function thresholdStatus(t: Threshold, value: number | null): ThresholdStatus {
  if (value === null) return 'n/a'
  return (t.op === '>=' ? value >= t.value : value <= t.value) ? 'pass' : 'fail'
}

/** True when every applicable metric meets its threshold. */
export function meetsThresholds(s: Summary): boolean {
  return THRESHOLDS.every((t) => thresholdStatus(t, s.metrics[t.key]) !== 'fail')
}
