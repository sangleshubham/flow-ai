// §16 L5: the `critic` role judges a rendered PNG against the plan item's intent and a text summary of
// the IR. It never receives book text (no evidence quotes, no blocks), so it judges the picture, not the facts.
import type { CriticReport } from '../schemas/quality.ts'
import { criticPasses } from '../schemas/quality.ts'
import type { LlmCall, LlmResult } from '../schemas/ports.ts'
import type { VisualKind } from '../schemas/plan.ts'

/** `<`, `>` and `&` escaped, so model-written labels cannot open or close a prompt tag. */
export const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Deep copy of an IR without `evidence` (the only place book text lives in an IR). */
function stripEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEvidence)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'evidence').map(([k, v]) => [k, stripEvidence(v)]))
  return value
}

/** Text summary of an IR for the critic: its JSON without evidence. */
export function summarizeIr(ir: unknown): string {
  return JSON.stringify(stripEvidence(ir))
}

export interface CritiqueInput {
  kind: VisualKind
  ir: unknown
  /** The plan item's intent (≤ 25 words, model-written). */
  intent: string
  /** PNG of the rendered visual (900 px wide at 2×), base64 without the data: prefix. */
  pngBase64: string
}

/** The request body the critic sees; exported so fixtures can be keyed by it. */
export function criticBody(i: Pick<CritiqueInput, 'kind' | 'ir' | 'intent'>): string {
  return `<intent>${escapeXml(i.intent)}</intent>\n<ir_summary kind="${i.kind}">${escapeXml(summarizeIr(i.ir))}</ir_summary>`
}

/**
 * Calls the `critic` role once. `pass` is recomputed with the §16 rule (every score ≥ 3, no
 * `wrong-direction` or `mislabel` issue) rather than trusted from the model.
 */
export async function critique(
  llm: LlmCall,
  input: CritiqueInput,
  opts: { signal?: AbortSignal; bookId?: string; sectionId?: string } = {},
): Promise<{ report: CriticReport; result: LlmResult<CriticReport> }> {
  const result = await llm.call('critic', { prefix: '', body: criticBody(input) }, {
    ...opts,
    schemaName: 'CriticReport',
    image: { mediaType: 'image/png', base64: input.pngBase64 },
  })
  return { report: { ...result.data, pass: criticPasses(result.data) }, result }
}
