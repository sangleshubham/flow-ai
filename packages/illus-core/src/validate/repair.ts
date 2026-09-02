// The `repair` role (§16): one attempt to fix an IR from validator (L3), render (L4) or critic (L5)
// findings. The repaired IR goes through `validate()` again with the same permitted blocks, so a repair
// can never gain evidence the extraction could not quote.
import type { IrKind } from '../schemas/ir.ts'
import type { LlmCall, LlmContext, LlmResult, ValidationContext, ValidationResult } from '../schemas/ports.ts'
import type { CriticReport, ValidationIssue } from '../schemas/quality.ts'
import type { TemplateId } from '../schemas/plan.ts'

import { escapeXml } from './critic.ts'
import { SCHEMA_OF, validate } from './index.ts'

/** A finding to fix: a validation/render issue or a critic issue. */
export type RepairFinding = ValidationIssue | CriticReport['issues'][number]

export interface RepairInput {
  kind: Exclude<IrKind, 'html'>
  /** The IR to fix (the validated one, or the last attempt). */
  ir: unknown
  findings: readonly RepairFinding[]
  /** The same packed context the extractor saw: the repair may re-quote only these blocks. */
  context: LlmContext
  validation: ValidationContext
  signal?: AbortSignal
  bookId?: string
  sectionId?: string
}

/** The request body of a repair call; exported so fixtures can be keyed by it. */
export function repairBody(i: Pick<RepairInput, 'kind' | 'ir' | 'findings' | 'context'>): string {
  return `${i.context.body}\n<ir kind="${i.kind}">${escapeXml(JSON.stringify(i.ir))}</ir>\n<issues>${escapeXml(JSON.stringify(i.findings))}</issues>`
}

/**
 * Calls `repair` once and re-validates its output. Model errors (`LlmError`) propagate: the caller keeps
 * the unrepaired visual. The caller adopts the result only when `report.ok`.
 */
export async function repairIr(
  llm: LlmCall,
  input: RepairInput,
): Promise<ValidationResult & { result: LlmResult<unknown> }> {
  const templateId = input.kind === 'template' ? (input.ir as { templateId?: TemplateId } | null)?.templateId : undefined
  const result = await llm.call('repair', { prefix: input.context.prefix, body: repairBody(input) }, {
    schemaName: SCHEMA_OF[input.kind] as never,
    ...(templateId && { templateId }),
    ...(input.signal && { signal: input.signal }),
    ...(input.bookId && { bookId: input.bookId }),
    ...(input.sectionId && { sectionId: input.sectionId }),
  })
  return { ...validate(input.kind, result.data, input.validation), result }
}
