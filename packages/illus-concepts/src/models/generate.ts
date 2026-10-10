// Generating a patch for section S (§13 steps 1–6): catch-up, rebase, out-of-order insertion,
// re-validation of later patches, and the concept-model route the W3 orchestrator calls.
import {
  ConceptModelKind,
  ground as defaultGround,
  groundingScore,
  makeConceptModelId,
} from '@illus/core'
import type {
  Block,
  ConceptModel,
  GroundingFn,
  IllusRepos,
  LlmCall,
  Patch,
  PatchOp,
  PlanItem,
  SectionNode,
  ValidationIssue,
  ValidationReport,
  VisualKind,
} from '@illus/core'
import { attrs, escapeText, packContext } from '@illus/context'
import type { LexicalSearch, PackedContext } from '@illus/context'

import { addedElement, applyOps, applyPatches, conceptModelState, findElement, isAddOp, opEvidence, opId, toIR } from './apply.ts'
import type { ModelIR, ModelState } from './apply.ts'

/** At most this many skipped sections are caught up before S; more → one rebased patch (§13 steps 3–4). */
export const MAX_CATCH_UP = 3
/** §7 patcher budget, used when no prompt registry is given. */
export const PATCHER_BUDGET_TOKENS = 14_000

export interface ConceptModelDeps {
  repos: Pick<IllusRepos, 'books' | 'sections' | 'blocks' | 'crossRefs' | 'sectionIndex' | 'concepts' | 'conceptModels'>
  llm: LlmCall
  /** Prompt registry of `@illus/llm`, for the patcher's context budget. */
  prompts?: { get(role: 'patcher'): { budgetTokens: number } }
  ground?: GroundingFn
  lexical?: LexicalSearch
  /** "Catching up the concept model: N sections" (§13 step 3); called only when N > 0. */
  onCatchUp?: (e: { conceptModelId: string; sectionId: string; count: number }) => void
}

export interface GeneratePatchOptions {
  /** The plan item that asked for the model; its intent goes to the patcher. */
  planItem?: PlanItem
  signal?: AbortSignal
}

export interface GeneratePatchResult {
  model: ConceptModel
  /** The patch of section S (reused when one exists and is not stale). */
  patch: Patch
  /** Gap sections patched first, in order. */
  caughtUp: string[]
  report: ValidationReport
  promptVersions: Record<string, string>
  models: Record<string, string>
  usageTokens: number
}

/** Input and output of `ConceptModelRoute` in `@illus/pipeline` (structurally; concepts cannot import pipeline). */
export interface ConceptModelRouteInput {
  planItem: PlanItem
  section: SectionNode
  context: PackedContext
  llm: LlmCall
}
export interface ConceptModelRouteOutput {
  kind: VisualKind
  ir: ModelIR
  report: ValidationReport
  promptVersions: Record<string, string>
  models: Record<string, string>
  usageTokens: number
}

export class ConceptModelError extends Error {
  readonly report: ValidationReport | undefined
  constructor(message: string, report?: ValidationReport) {
    super(message)
    this.name = 'ConceptModelError'
    this.report = report
  }
}

/** `${conceptId}:m:${kind}` (W0 id convention) → its parts. */
export function parseConceptModelId(id: string): { conceptId: string; kind: ConceptModelKind } {
  const m = /^(.+):m:([a-z]+)$/.exec(id)
  const kind = ConceptModelKind.safeParse(m?.[2])
  if (!m || !kind.success) throw new ConceptModelError(`not a concept model id: ${id}`)
  return { conceptId: m[1]!, kind: kind.data }
}

/** The model a plan item extends or starts. */
export function conceptModelIdOf(item: Pick<PlanItem, 'kind' | 'conceptModelId' | 'newConceptModel'>): string | undefined {
  if (item.conceptModelId) return item.conceptModelId
  const kind = ConceptModelKind.safeParse(item.kind)
  return item.newConceptModel && kind.success ? makeConceptModelId(item.newConceptModel, kind.data) : undefined
}

/** Inserts (or replaces) a section's patch, keeping patches sorted by `sectionOrdinal`. */
export function insertPatch(model: ConceptModel, patch: Patch): ConceptModel {
  const rest = model.patches.filter((p) => p.sectionId !== patch.sectionId)
  const at = rest.findIndex((p) => p.sectionOrdinal > patch.sectionOrdinal)
  return { ...model, patches: at < 0 ? [...rest, patch] : [...rest.slice(0, at), patch, ...rest.slice(at)] }
}

/**
 * Rewrites an op for a state where its target may already exist (§13 step 5): an add of an existing id
 * becomes an update of the fields that differ, or nothing when none differ. `null` = cannot be reconciled.
 */
function reconcile(state: ModelState, op: PatchOp): PatchOp | 'drop' | null {
  if (!isAddOp(op)) return op
  const el = addedElement(op)
  const cur = findElement(state, el.item.id)
  if (!cur) return op
  if (cur.type !== el.type) return null
  const a = el.item as Record<string, unknown>
  const b = cur.item as Record<string, unknown>
  if (['from', 'to', 'parent'].some((k) => a[k] !== undefined && a[k] !== b[k])) return null
  const labelKey = el.type === 'transition' ? 'event' : 'label'
  const diff: { label?: string; sublabel?: string; group?: string } = {}
  if (a[labelKey] !== undefined && a[labelKey] !== b[labelKey]) diff.label = a[labelKey] as string
  if (a.sublabel !== undefined && a.sublabel !== b.sublabel) diff.sublabel = a.sublabel as string
  if (a.group !== undefined && a.group !== b.group) diff.group = a.group as string
  return Object.keys(diff).length ? { op: 'update', id: el.item.id, ...diff, evidence: el.item.evidence } : 'drop'
}

/**
 * Re-validates every patch after `ordinal` against the state the earlier patches now produce (§13 step 5).
 * Adds of existing ids become updates; a patch that still fails is marked stale (regenerated on its next visit).
 */
export function revalidateAfter(model: ConceptModel, ordinal: number): ConceptModel {
  let state = applyPatches(model, ordinal).state
  const patches = model.patches.map((p) => {
    if (p.sectionOrdinal <= ordinal || p.stale) return p
    const ops: PatchOp[] = []
    let next = state
    for (const op of p.ops) {
      const r = reconcile(next, op)
      if (r === 'drop') continue
      const applied = r && applyOps(next, [r])
      if (!applied || applied.issues.length) return { ...p, stale: true }
      ops.push(r)
      next = applied.state
    }
    state = next
    return { ...p, ops }
  })
  return { ...model, patches }
}

const emptyReport = (): ValidationReport => ({
  ok: true,
  groundingScore: 1,
  counts: { total: 0, grounded: 0, halfGrounded: 0, fuzzy: 0, dropped: 0 },
  dropped: [],
  issues: [],
  retried: false,
  escalated: false,
})

/**
 * Grounds and applies a patcher answer against `state` (§13 step 6). Ops with ungrounded evidence or that do
 * not apply (duplicate id, unresolved reference, unknown id, wrong kind) are dropped and reported.
 */
export function checkPatch(
  state: ModelState,
  ops: readonly PatchOp[],
  blocks: ReadonlyMap<string, Block>,
  ground: GroundingFn = defaultGround,
): { ops: PatchOp[]; report: ValidationReport } {
  const kept: PatchOp[] = []
  const issues: ValidationIssue[] = []
  const dropped: string[] = []
  const counts = { total: ops.length, grounded: 0, halfGrounded: 0, fuzzy: 0, dropped: 0 }
  let s = state
  for (const op of ops) {
    const id = opId(op)
    const g = ground(opEvidence(op), { blocks, ...(isAddOp(op) && { label: (addedElement(op).item as { label?: string }).label ?? '' }) })
    if (g.status === 'failed' || !g.evidence) {
      issues.push({ layer: 'grounding', severity: 'error', code: 'quote-not-found', message: `${op.op} ${id}: ${g.reason ?? 'quote not found'}`, elementId: id })
      dropped.push(id)
      continue
    }
    const grounded = withEvidence(op, g.evidence)
    const r = applyOps(s, [grounded])
    if (r.issues.length) {
      for (const i of r.issues) issues.push({ layer: 'structure', severity: 'error', code: i.code, message: `${op.op} ${id}: ${i.message}`, elementId: id })
      dropped.push(id)
      continue
    }
    if (g.status === 'grounded') counts.grounded++
    else counts.halfGrounded++
    if (g.evidence.fuzzy) counts.fuzzy++
    s = r.state
    kept.push(grounded)
  }
  counts.dropped = dropped.length
  return {
    ops: kept,
    report: { ok: kept.length > 0, groundingScore: groundingScore(counts), counts, dropped, issues, retried: false, escalated: false },
  }
}

function withEvidence(op: PatchOp, evidence: ReturnType<typeof opEvidence>): PatchOp {
  switch (op.op) {
    case 'addNode':
      return { ...op, node: { ...op.node, evidence } }
    case 'addEdge':
      return { ...op, edge: { ...op.edge, evidence } }
    case 'addGroup':
      return { ...op, group: { ...op.group, evidence } }
    case 'addParticipant':
    case 'addMessage':
    case 'addState':
    case 'addTransition':
      return { ...op, item: { ...op.item, evidence } } as PatchOp
    default:
      return { ...op, evidence }
  }
}

function reportBlock(report: ValidationReport): string {
  return [
    `<validator_report${attrs([['dropped', report.counts.dropped], ['total', report.counts.total]])}>`,
    ...report.issues.map((i) => `  <issue${attrs([['code', i.code], ['element', i.elementId]])}>${escapeText(i.message)}</issue>`),
    '  <retry>Your previous answer failed these checks. Answer again: reuse the ids in the concept model, quote verbatim from this section, and only refer to elements that exist or that you add first.</retry>',
    '</validator_report>',
  ].join('\n')
}

export interface ConceptModels {
  /** §13 steps 1–6 for one section; serialised per model. */
  generatePatch(sectionId: string, conceptModelId: string, opts?: GeneratePatchOptions): Promise<GeneratePatchResult>
  /** `PipelineDeps.conceptModels` (behind the `conceptModels` flag): patches the model, returns S's view IR. */
  route(input: ConceptModelRouteInput): Promise<ConceptModelRouteOutput>
}

export function createConceptModels(deps: ConceptModelDeps): ConceptModels {
  const { repos } = deps
  const ground = deps.ground ?? defaultGround
  // ponytail: one in-memory lock per model per instance; a second tab could still race (last write wins).
  const locks = new Map<string, Promise<unknown>>()
  const serial = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn)
    locks.set(key, run.catch(() => undefined))
    return run
  }

  async function permittedBlocks(section: SectionNode, packed: PackedContext): Promise<Map<string, Block>> {
    // Evidence comes from the current section or the blocks it references (§13 patcher rules).
    const own = await repos.blocks.listBySection(section.sectionId)
    const used = new Set(packed.usedBlockIds)
    const refs = (await Promise.all(own.map((b) => repos.crossRefs.listFromBlock(b.blockId)))).flat()
    const refIds = refs.flatMap((r) => (r.resolved && r.targetBlockId && used.has(r.targetBlockId) ? [r.targetBlockId] : []))
    const referenced = (await repos.blocks.bulkGet(refIds)).filter((b): b is Block => !!b)
    return new Map([...own, ...referenced].map((b) => [b.blockId, b]))
  }

  async function generate(
    llm: LlmCall,
    model: ConceptModel,
    section: SectionNode,
    item: PlanItem,
    opts: { rebasedFrom?: SectionNode[]; signal?: AbortSignal | undefined },
  ) {
    const state = applyPatches(model, section.ordinal - 1).state
    const packed = await packContext({
      role: 'patcher',
      sectionId: section.sectionId,
      planItem: { ...item, conceptModelId: model.conceptModelId },
      budgetTokens: deps.prompts?.get('patcher').budgetTokens ?? PATCHER_BUDGET_TOKENS,
      repo: { ...repos, conceptModels: { get: async () => model }, ...(deps.lexical && { lexical: deps.lexical }) },
      conceptModelState,
    })
    const blocks = await permittedBlocks(section, packed)
    let body = packed.body
    if (opts.rebasedFrom) {
      const summaries = await Promise.all(opts.rebasedFrom.map(async (s) => [s, (await repos.sectionIndex.get(s.sectionId))?.summary] as const))
      body += `\n<gap_summaries>\n${summaries
        .filter(([, sum]) => sum)
        .map(([s, sum]) => `  <gap_summary${attrs([['section', s.title], ['ordinal', s.ordinal]])}>${escapeText(sum!)}</gap_summary>`)
        .join('\n')}\n</gap_summaries>`
    }
    const callOpts = { schemaName: 'PatchOutput' as const, bookId: section.bookId, sectionId: section.sectionId, ...(opts.signal && { signal: opts.signal }) }
    let usage = 0
    let res = await llm.call('patcher', { prefix: packed.prefix, body }, callOpts)
    usage += res.usage.input + res.usage.output
    let checked = checkPatch(state, res.data.ops, blocks, ground)
    if (checked.report.counts.dropped > 0) {
      res = await llm.call('patcher', { prefix: packed.prefix, body: `${body}\n${reportBlock(checked.report)}` }, callOpts)
      usage += res.usage.input + res.usage.output
      checked = checkPatch(state, res.data.ops, blocks, ground)
      checked.report.retried = true
    }
    const patch: Patch = {
      patchId: `${model.conceptModelId}@${section.sectionId}`,
      sectionId: section.sectionId,
      sectionOrdinal: section.ordinal,
      ops: checked.ops,
      createdWith: { model: res.model, promptVersion: res.promptVersion },
      ...(opts.rebasedFrom && { rebased: true }),
      ...(!checked.report.ok && { stale: true }),
    }
    const next = revalidateAfter(insertPatch(model, patch), section.ordinal)
    await repos.conceptModels.put(next)
    return { model: next, patch, report: checked.report, usage, res }
  }

  async function generatePatch(sectionId: string, conceptModelId: string, opts: GeneratePatchOptions = {}, llm = deps.llm): Promise<GeneratePatchResult> {
    return serial(conceptModelId, async () => {
      const section = await repos.sections.get(sectionId)
      if (!section) throw new ConceptModelError(`unknown section ${sectionId}`)
      const { conceptId, kind } = parseConceptModelId(conceptModelId)
      let model: ConceptModel = (await repos.conceptModels.get(conceptModelId)) ?? { conceptModelId, conceptId, bookId: section.bookId, kind, patches: [] }

      // Step 1: reuse S's patch unless it went stale.
      const existing = model.patches.find((p) => p.sectionId === sectionId)
      if (existing && !existing.stale)
        return { model, patch: existing, caughtUp: [], report: emptyReport(), promptVersions: {}, models: {}, usageTokens: 0 }

      // Step 2: sections between the last patched ordinal and S that use the concept.
      const [concept, sections] = await Promise.all([repos.concepts.get(conceptId), repos.sections.listByBook(section.bookId)])
      const patched = new Set(model.patches.map((p) => p.sectionId))
      const last = Math.max(-1, ...model.patches.filter((p) => p.sectionOrdinal < section.ordinal).map((p) => p.sectionOrdinal))
      const uses = new Set(concept?.usedInSectionIds ?? [])
      const gaps = sections
        .filter((s) => uses.has(s.sectionId) && !patched.has(s.sectionId) && s.ordinal > last && s.ordinal < section.ordinal)
        .sort((a, b) => a.ordinal - b.ordinal)
      const item: PlanItem = opts.planItem ?? {
        planItemId: 'concept-model',
        kind,
        intent: `Extend the ${concept?.canonical ?? 'concept'} model with what this section adds`,
        conceptIds: [conceptId],
        priority: 1,
        animate: false,
      }
      const plan: PlanItem = { ...item, kind }
      delete plan.newConceptModel

      let usage = 0
      const promptVersions: Record<string, string> = {}
      const models: Record<string, string> = {}
      const caughtUp: string[] = []
      // Step 3: catch up at most MAX_CATCH_UP gaps, in order. A gap that fails is stored stale (retried on its visit).
      if (gaps.length && gaps.length <= MAX_CATCH_UP) {
        deps.onCatchUp?.({ conceptModelId, sectionId, count: gaps.length })
        for (const g of gaps) {
          const r = await generate(llm, model, g, plan, { signal: opts.signal })
          model = r.model
          usage += r.usage
          caughtUp.push(g.sectionId)
        }
      }
      // Step 4: more gaps → one rebased patch from the state plus the gaps' summaries.
      const r = await generate(llm, model, section, plan, { signal: opts.signal, ...(gaps.length > MAX_CATCH_UP && { rebasedFrom: gaps }) })
      usage += r.usage
      promptVersions.patcher = r.res.promptVersion
      models.patcher = `${r.res.model}@${r.res.effort}`
      if (!r.report.ok) throw new ConceptModelError('the patch failed validation', r.report)
      return { model: r.model, patch: r.patch, caughtUp, report: r.report, promptVersions, models, usageTokens: usage }
    })
  }

  return {
    generatePatch: (sectionId, conceptModelId, opts) => generatePatch(sectionId, conceptModelId, opts),
    async route({ planItem, section, llm }) {
      const id = conceptModelIdOf(planItem)
      if (!id) throw new ConceptModelError(`plan item ${planItem.planItemId} has no concept model`)
      const r = await generatePatch(section.sectionId, id, { planItem }, llm)
      const concept = await repos.concepts.get(r.model.conceptId)
      const ir = toIR(applyPatches(r.model, section.ordinal).state, concept?.canonical ?? planItem.intent)
      return { kind: r.model.kind, ir, report: r.report, promptVersions: r.promptVersions, models: r.models, usageTokens: r.usageTokens }
    },
  }
}
