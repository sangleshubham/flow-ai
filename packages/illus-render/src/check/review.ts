// §16 L4 and L5 for one stored visual: render → render checks → (graph) deterministic LR↔TB retry →
// one `repair` for remaining render findings → critic → one `repair` with the critic's issues →
// critic again. A visual that still fails is kept, with its critic report and findings as warnings
// (the pane shows the warning badge). DOM-free: the renderer is injected (`renderForReview` in the app).
import { addIssues, critique, LlmError, needsReextract, repairIr } from '@illus/core'
import type {
  CriticReport,
  IR,
  LlmCall,
  LlmContext,
  LlmResult,
  RepairFinding,
  ValidationContext,
  ValidationIssue,
  ValidationReport,
  VisualRecord,
} from '@illus/core'

/** What one render produced: L4 findings and the PNG for the critic (null when the kind has no SVG). */
export interface Rendered {
  issues: ValidationIssue[]
  pngBase64: string | null
}

export interface ReviewEnv {
  llm: LlmCall
  /** Renders an IR offscreen (900 px wide, 2×) and runs the render checks. */
  render: (ir: IR) => Promise<Rendered>
  /** The plan item's intent, for the critic. */
  intent: string
  /** Run the critic (§16 L5; the `critic` flag and setting). Default true. */
  critic?: boolean
  /**
   * The extractor's packed context and permitted blocks, so `repair` can re-quote and its answer is
   * re-validated (§16). Without it, findings are recorded but nothing is repaired.
   */
  repair?: { context: LlmContext; validation: ValidationContext }
  signal?: AbortSignal
}

/** Kinds the review skips: no IR (trace) or no SVG to judge (math is KaTeX HTML; html is sandboxed). */
const SKIP = new Set(['trace', 'math', 'html'])

const has = (r: Rendered, code: string) => r.issues.some((i) => i.code === code)

/** Plan-limit and abort stop the job; every other model failure just leaves the visual unrepaired. */
function fatal(e: unknown): boolean {
  return e instanceof LlmError && (e.code === 'aborted' || e.code === 'plan-limit')
}

export async function reviewVisual(record: VisualRecord, env: ReviewEnv): Promise<VisualRecord> {
  if (SKIP.has(record.kind) || !record.ir || typeof record.ir !== 'object') return record
  let ir = record.ir as IR
  let report: ValidationReport = record.validation
  let usage = record.usageTokens
  const models = { ...record.models }
  const promptVersions = { ...record.promptVersions }
  const note = (role: string, res: LlmResult<unknown>) => {
    models[role] = `${res.model}@${res.effort}`
    promptVersions[role] = res.promptVersion
    usage += res.usage.input + res.usage.output
  }
  const extra: ValidationIssue[] = []

  /** One repair attempt; adopted only when the answer validates cleanly. */
  const tryRepair = async (findings: readonly RepairFinding[], layer: 'render' | 'structure'): Promise<boolean> => {
    if (!env.repair || ir.type === 'html') return false
    try {
      const fixed = await repairIr(env.llm, {
        kind: ir.type,
        ir,
        findings,
        ...env.repair,
        ...(env.signal && { signal: env.signal }),
        bookId: record.bookId,
        sectionId: record.sectionId,
      })
      note('repair', fixed.result)
      if (!fixed.report.ok || needsReextract(fixed.report)) {
        extra.push({ layer, severity: 'warning', code: 'repair-rejected', message: 'the repaired IR failed validation; the original is kept' })
        return false
      }
      ir = fixed.ir as IR
      report = { ...fixed.report, retried: report.retried, escalated: report.escalated }
      extra.push({ layer, severity: 'warning', code: 'repaired', message: `repaired: ${[...new Set(findings.map((f) => ('code' in f ? f.code : f.kind)))].join(', ')}`, autoFixed: true })
      return true
    } catch (e) {
      if (fatal(e)) throw e
      extra.push({ layer, severity: 'warning', code: 'repair-failed', message: (e as Error).message })
      return false
    }
  }

  let shown: Rendered
  try {
    shown = await env.render(ir)
    // L4: deterministic re-layout first (§16): the other direction, kept when it fixes the aspect ratio.
    if (ir.type === 'graph' && has(shown, 'aspect-ratio')) {
      const flipped: IR = { ...ir, direction: ir.direction === 'LR' ? 'TB' : 'LR' }
      const again = await env.render(flipped)
      if (!has(again, 'aspect-ratio')) {
        ir = flipped
        shown = again
        extra.push({ layer: 'render', severity: 'warning', code: 'direction-flipped', message: `laid out ${flipped.direction} to fix the aspect ratio`, autoFixed: true })
      }
    }
    // L4: then one repair for what re-layout could not fix.
    if (shown.issues.length && (await tryRepair(shown.issues, 'render'))) shown = await env.render(ir)
  } catch (e) {
    if (fatal(e)) throw e
    return { ...record, validation: addIssues(record.validation, [{ layer: 'render', severity: 'warning', code: 'render-check-failed', message: (e as Error).message }]) }
  }

  // L5: critic, one repair with its issues, critic again; still failing → kept with its report.
  let critic: CriticReport | undefined = record.critic
  const judge = async () => {
    if (!shown.pngBase64) return
    const c = await critique(env.llm, { kind: ir.type, ir, intent: env.intent, pngBase64: shown.pngBase64 }, {
      ...(env.signal && { signal: env.signal }),
      bookId: record.bookId,
      sectionId: record.sectionId,
    })
    note('critic', c.result)
    critic = c.report
  }
  if (env.critic !== false) {
    try {
      await judge()
      if (critic && !critic.pass && (await tryRepair(critic.issues, 'structure'))) {
        shown = await env.render(ir)
        await judge()
      }
    } catch (e) {
      if (fatal(e)) throw e
      extra.push({ layer: 'render', severity: 'warning', code: 'critic-failed', message: (e as Error).message })
    }
  }

  return {
    ...record,
    ir,
    validation: addIssues(report, [...shown.issues, ...extra]),
    ...(critic && { critic }),
    usageTokens: usage,
    models,
    promptVersions,
  }
}
