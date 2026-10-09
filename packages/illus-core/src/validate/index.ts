// Structural validators: validate(kind, ir, ctx) (§16 L1–L3). Owner: W10. Pure and synchronous.
//
// L1 Zod parse → L2 grounding of every evidence-bearing element (drop failed ones and anything that then
// dangles) → L3 kind-specific rules, with auto-fixes only where nothing is invented or reinterpreted.
// Template invariants plug in through `ctx.templates` (W5); animation issues (W6) are merged with
// `addIssues`.
import { SCHEMAS } from '../schemas/llm.ts'
import type { IrKind, IrOf } from '../schemas/ir.ts'
import type { VisualKind } from '../schemas/plan.ts'
import type { ValidationContext, ValidationResult } from '../schemas/ports.ts'
import type { ValidationIssue, ValidationReport } from '../schemas/quality.ts'

import { Checker } from './checker.ts'
import { RULES } from './rules.ts'

/** Share of dropped elements above which the extractor is re-run once (§8 stage 3 step 3, §16 L2). */
export const MAX_DROPPED_SHARE = 0.3

/** Output schema of each IR kind. */
export const SCHEMA_OF: Record<IrKind, keyof typeof SCHEMAS> = {
  graph: 'GraphIR',
  sequence: 'SequenceIR',
  state: 'StateIR',
  class: 'ClassIR',
  er: 'ErIR',
  template: 'TemplateIR',
  chart: 'ChartIR',
  math: 'MathIR',
  timeline: 'TimelineIR',
  html: 'HtmlIR',
}

/**
 * Schema, grounding and structural checks for one IR (§16 L1–L3). Returns the IR after dropping
 * ungrounded and dangling elements and applying safe auto-fixes, plus the report. `report.ok` is false
 * when any error remains (the caller then runs `repair` once, §16). Never throws on bad input.
 */
export function validate<K extends VisualKind>(
  kind: K,
  ir: unknown,
  ctx: ValidationContext,
): ValidationResult<K extends IrKind ? IrOf<K> : unknown> {
  const c = new Checker(ctx)
  if (kind === 'trace') {
    c.issue('schema', 'error', 'unsupported-kind', 'trace visuals carry a Trace, not an IR; validate the trace instead')
    return { ir: ir as never, report: c.report() }
  }
  const parsed = SCHEMAS[SCHEMA_OF[kind as IrKind]].safeParse(ir)
  if (!parsed.success) {
    for (const i of parsed.error.issues) c.issue('schema', 'error', 'schema', `${i.path.join('.') || '(root)'}: ${i.message}`)
    return { ir: ir as never, report: c.report() }
  }
  const rule = RULES[kind as IrKind] as (ir: unknown, c: Checker) => unknown
  return { ir: rule(structuredClone(parsed.data), c) as never, report: c.report() }
}

/** §8 stage 3 step 3: more than 30% of elements dropped, or too few left for the intent → re-extract once. */
export function needsReextract(report: ValidationReport): boolean {
  return (
    (report.counts.total > 0 && report.counts.dropped / report.counts.total > MAX_DROPPED_SHARE) ||
    report.issues.some((i) => i.code === 'too-few-elements')
  )
}

/**
 * Merges issues from another check into a report (the hook for W6's animation validation, §11, and
 * for render checks, §16 L4) and recomputes `ok`.
 */
export function addIssues(report: ValidationReport, issues: readonly ValidationIssue[]): ValidationReport {
  const all = [...report.issues, ...issues]
  return { ...report, issues: all, ok: !all.some((i) => i.severity === 'error') }
}

export { critique, criticBody, escapeXml, summarizeIr } from './critic.ts'
export type { CritiqueInput } from './critic.ts'
export { repairBody, repairIr } from './repair.ts'
export type { RepairFinding, RepairInput } from './repair.ts'
