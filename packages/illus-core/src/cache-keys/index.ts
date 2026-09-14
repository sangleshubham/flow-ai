// Cache keys exactly as §5 "Cache keys": SHA-256 over the JSON array of the listed parts, in order.
// Version constants are owned by the packages that bump them (CONTEXT_VERSION: @illus/context,
// COMPILER_VERSION: @illus/core/compile, TRACER_VERSION: @illus/tracer) and passed in.
import { sha256Hex } from '../hash/index.ts'
import type { ReasoningEffort } from '../schemas/common.ts'
import type { TemplateId, VisualKind } from '../schemas/plan.ts'

/** The prompt version, model and effort that produced a result; all three are key parts (§9). */
export interface RoleRun {
  promptVersion: string
  model: string
  effort: ReasoningEffort
}

/** `undefined` becomes `null` so optional parts hash deterministically. */
function keyOf(parts: readonly unknown[]): Promise<string> {
  return sha256Hex(
    JSON.stringify(parts.map((p) => (p === undefined ? null : p))),
  )
}

export interface PlanKeyInput {
  bookId: string
  sectionId: string
  contentHash: string
  contextVersion: string | number
  planner: RoleRun
  /** Sorted, comma-joined enabled flag-gated kinds; appended only when present, so older keys are unchanged. */
  kinds?: string
}

/** `sha256([bookId, sectionId, contentHash, CONTEXT_VERSION, planner.promptVersion, planner.model, planner.effort, kinds?])` */
export function planKey(i: PlanKeyInput): Promise<string> {
  const parts: unknown[] = [
    i.bookId,
    i.sectionId,
    i.contentHash,
    i.contextVersion,
    i.planner.promptVersion,
    i.planner.model,
    i.planner.effort,
  ]
  if (i.kinds) parts.push(i.kinds)
  return keyOf(parts)
}

export interface VisualKeyInput {
  planKey: string
  planItem: { kind: VisualKind; templateId?: TemplateId; intent: string }
  extractor: RoleRun
  compilerVersion: string | number
  /** "Regenerate with instruction" (§8): appended only when non-empty, so the new result is a new record. */
  instruction?: string
}

/** `sha256([planKey, kind, templateId, intent, extractor.promptVersion, extractor.model, extractor.effort, COMPILER_VERSION])` */
export function visualKey(i: VisualKeyInput): Promise<string> {
  const parts: unknown[] = [
    i.planKey,
    i.planItem.kind,
    i.planItem.templateId,
    i.planItem.intent,
    i.extractor.promptVersion,
    i.extractor.model,
    i.extractor.effort,
    i.compilerVersion,
  ]
  if (i.instruction) parts.push(i.instruction)
  return keyOf(parts)
}

export interface TraceKeyInput {
  codeSource: string
  translator: RoleRun
  tracerVersion: string | number
}

/** `sha256([codeBlock.source, translator.promptVersion, translator.model, translator.effort, TRACER_VERSION])` */
export function traceKey(i: TraceKeyInput): Promise<string> {
  return keyOf([
    i.codeSource,
    i.translator.promptVersion,
    i.translator.model,
    i.translator.effort,
    i.tracerVersion,
  ])
}
