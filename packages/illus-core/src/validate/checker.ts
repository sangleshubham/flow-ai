// Accumulates grounding outcomes, drops and issues while one IR is validated. Internal to validate/.
import type { Evidence } from '../schemas/common.ts'
import type { ValidationContext } from '../schemas/ports.ts'
import type { ValidationIssue, ValidationReport } from '../schemas/quality.ts'
import { groundingScore } from '../grounding/index.ts'

/** Collects grounding outcomes and issues while one IR is checked. */
export class Checker {
  readonly counts = { total: 0, grounded: 0, halfGrounded: 0, fuzzy: 0, dropped: 0 }
  readonly dropped: string[] = []
  readonly issues: ValidationIssue[] = []

  readonly ctx: ValidationContext

  constructor(ctx: ValidationContext) {
    this.ctx = ctx
  }

  /**
   * Grounds one element's evidence (§16 L2). Returns the corrected evidence, or the failure reason when
   * the quote failed (the caller decides whether the element can be dropped).
   */
  ground(elementId: string, label: string | undefined, evidence: Evidence): Evidence | string {
    this.counts.total++
    const r = this.ctx.ground(evidence, { blocks: this.ctx.blocks, label, aliases: label ? this.aliasesOf(label) : undefined })
    if (r.status === 'failed' || !r.evidence) return `"${evidence.quote}": ${r.reason ?? 'not found'}`
    if (r.evidence.fuzzy) this.counts.fuzzy++
    if (r.status === 'half-grounded') {
      this.counts.halfGrounded++
      this.issue('grounding', 'warning', 'half-grounded', r.reason ?? 'label not found near the quote', elementId)
    } else this.counts.grounded++
    return r.evidence
  }

  /** Keeps the items whose evidence grounds, with corrected evidence; drops (and records) the rest. */
  keep<T extends { evidence: Evidence }>(items: readonly T[], id: (t: T) => string, label: (t: T) => string | undefined): T[] {
    return items.flatMap((t) => {
      const e = this.ground(id(t), label(t), t.evidence)
      if (typeof e !== 'string') return [{ ...t, evidence: e }]
      this.drop(id(t), 'quote-not-found', `dropped: ${e}`)
      return []
    })
  }

  /** Removes an element (ungrounded, or dangling after another was dropped). Not an error by itself. */
  drop(elementId: string, code: string, message: string): void {
    this.dropped.push(elementId)
    this.counts.dropped++
    this.issue('grounding', 'warning', code, message, elementId, true)
  }

  issue(
    layer: ValidationIssue['layer'],
    severity: ValidationIssue['severity'],
    code: string,
    message: string,
    elementId?: string,
    autoFixed?: boolean,
  ): void {
    const i: ValidationIssue = { layer, severity, code, message }
    if (elementId) i.elementId = elementId
    if (autoFixed) i.autoFixed = true
    this.issues.push(i)
  }

  error(code: string, message: string, elementId?: string): void {
    this.issue('structure', 'error', code, message, elementId)
  }

  warn(code: string, message: string, elementId?: string): void {
    this.issue('structure', 'warning', code, message, elementId)
  }

  fixed(code: string, message: string, elementId?: string): void {
    this.issue('structure', 'warning', code, message, elementId, true)
  }

  /** Glossary aliases of a label: matched case-insensitively against canonical names and their aliases. */
  private aliasesOf(label: string): string[] | undefined {
    if (!this.ctx.aliases) return undefined
    const l = label.trim().toLowerCase()
    for (const [canonical, aliases] of this.ctx.aliases)
      if ([canonical, ...aliases].some((a) => a.toLowerCase() === l)) return [canonical, ...aliases]
    return undefined
  }

  report(): ValidationReport {
    return {
      ok: !this.issues.some((i) => i.severity === 'error'),
      groundingScore: groundingScore(this.counts),
      counts: { ...this.counts },
      dropped: [...this.dropped],
      issues: [...this.issues],
      retried: false,
      escalated: false,
    }
  }
}
