// The section orchestrator (§15): cache → context → plan → extract → validate → (animate, review) → store.
import {
  COMPILER_VERSION,
  ConceptModelKind,
  GraphIR,
  GraphSource,
  LlmError,
  ROLES,
  Translation,
  VisualKind,
  animationTargets,
  defaultStoryboard,
  ground as defaultGround,
  needsReextract,
  parseGraphSource,
  planKey,
  resolveFlags,
  sectionContentHash,
  sha256Hex,
  traceKey,
  validate as defaultValidate,
  visualKey,
} from '@illus/core'
import type {
  AnimationIR,
  Block,
  Flags,
  GroundingFn,
  IR,
  IllusRepos,
  LlmCall,
  LlmContext,
  LlmResult,
  PlanItem,
  PlanRecord,
  RoleName,
  RoleSpec,
  SchemaName,
  SectionNode,
  TemplateRegistry,
  TraceRunner,
  ValidationContext,
  ValidationIssue,
  ValidationReport,
  ValidationResult,
  Validator,
  VisualPlan,
  VisualRecord,
} from '@illus/core'
import { conceptModelIdOf, createConceptModels } from '@illus/concepts'
import { CONTEXT_VERSION, attrs, escapeText, packContext } from '@illus/context'
import type { LexicalSearch, PackedContext } from '@illus/context'
import { resolveRoute } from '@illus/llm'
import type { ModelsConfig } from '@illus/llm'

import { createLimiter, limitLlm } from './limiter.ts'

/** How long a request waits for `indexNow` before planning with partial context (§15 step 2). */
export const INDEX_WAIT_MS = 20_000
export const MAX_LLM_REQUESTS = 4
export const MAX_SECTIONS = 2
export const MAX_INSTRUCTION_CHARS = 300

// ---------------------------------------------------------------- public types

export type ItemStage =
  | 'queued'
  | 'cached'
  | 'extracting'
  | 'retrying'
  | 'escalating'
  | 'tracing'
  | 'catching-up'
  | 'patching'
  | 'animating'
  | 'critic'
  | 'storing'

export interface SectionJobEvents {
  plan: {
    plan: VisualPlan
    record: PlanRecord
    partialContext: boolean
    fromCache: boolean
  }
  'no-visual': { reason: string }
  /** `sections` is set for `catching-up`: "Catching up the concept model: N sections" (§13 step 3). */
  'item-progress': { planItemId: string; stage: ItemStage; sections?: number }
  /**
   * The validated IR, before animation and review (ADR 0054). Not stored yet: `item-ready` (or
   * `item-failed`) for the same item always follows and supersedes it. Only sent when a later step runs.
   */
  'item-preview': { planItemId: string; record: VisualRecord }
  'item-ready': { planItemId: string; record: VisualRecord; fromCache: boolean }
  'item-failed': {
    planItemId: string
    code: string
    message: string
    report?: ValidationReport
  }
  /** The job could not plan (unknown section, planner failure, plan limit). */
  error: { code: string; message: string }
  done: { cancelled: boolean }
}
export type SectionJobEvent = keyof SectionJobEvents

export interface SectionJob {
  /** The section actually generated (after `mergedInto`, or the synthetic selection id). */
  readonly sectionId: string
  on<E extends SectionJobEvent>(
    event: E,
    cb: (payload: SectionJobEvents[E]) => void,
  ): () => void
  /** Aborts every call of the job (planner, extractor, animator, repair, review) and starts no new step. */
  cancel(): void
  readonly cancelled: boolean
  /** Settles after `done` was emitted. */
  readonly finished: Promise<void>
}

export interface RequestOptions {
  /** "Illustrate anyway": re-plan, telling the planner the reader asked for a visual (§8). */
  force?: boolean
  /** "Regenerate with instruction" (≤ 300 characters): a new visual record, the old one is kept. */
  instruction?: string
  /** Kind override: re-runs stages 2–4 for `planItemId` (or every item) with this kind. */
  kindOverride?: VisualKind
  /** Run only this plan item. */
  planItemId?: string
  /** Keep jobs of other sections running (default: navigating cancels them). */
  keepOthers?: boolean
}

/** W8's patch flow (§13), injected; called for items with a concept model when `conceptModels` is on. */
export type ConceptModelRoute = (input: {
  planItem: PlanItem
  section: SectionNode
  context: PackedContext
  llm: LlmCall
}) => Promise<{
  kind: VisualKind
  ir: unknown
  report: ValidationReport
  promptVersions: Record<string, string>
  models: Record<string, string>
  usageTokens: number
}>

/**
 * W10's L4/L5 review: render checks, critic and repair. Gets what `repair` needs (the
 * extractor's exact context and permitted blocks); the returned record is stored, so repairs and
 * render findings persist. A rejected promise stores the unreviewed record.
 */
export type ReviewHook = (
  record: VisualRecord,
  ctx: {
    context: LlmContext
    validation: ValidationContext
    planItem: PlanItem
    signal?: AbortSignal
  },
) => Promise<VisualRecord>

export interface PipelineDeps {
  repos: IllusRepos
  llm: LlmCall
  /** Prompt registry of `@illus/llm` (version and budget of each role). */
  prompts: { get(role: RoleName): { version: string; budgetTokens: number } }
  /** `ILLUS_MODELS_JSON`: the expected model and effort enter cache-key lookups before any call. */
  models: ModelsConfig
  flags?: Flags | (() => Flags)
  validate?: Validator
  ground?: GroundingFn
  /** The concept pass (`@illus/concepts`), for `indexNow` (§15 step 2). */
  concepts?: { indexNow(sectionId: string): Promise<boolean> }
  indexWaitMs?: number
  /** W1's MiniSearch block index for the lexical fallback (§7). */
  lexical?: LexicalSearch
  /** W5's registry: template descriptions for the extractor and props checks for `validate()`. */
  templates?: TemplateRegistry
  /** W7: runs translated code in the Pyodide worker (`tracer` flag). */
  traceRunner?: TraceRunner
  tracerVersion?: string | number
  /** W6: validate against exactly the permitted packed blocks; errors drop animation, preserving static IR. */
  validateAnimation?: (
    ir: unknown,
    animation: AnimationIR,
    context: { blocks: ReadonlyMap<string, Block> },
  ) => ValidationIssue[]
  /** W8 (`conceptModels` flag). Default: `createConceptModels({ repos, llm, prompts, lexical, ground }).route`. */
  conceptModels?: ConceptModelRoute
  /**
   * W10 phase B: L4 render checks, L5 critic and repair; the returned record is stored. Called for every
   * new visual (§16: every visual passes L4); the app turns the L5 critic on or off with the `critic` flag in the hook's env.
   */
  review?: ReviewHook
  now?: () => number
  maxLlmRequests?: number
  maxSections?: number
}

export interface Pipeline {
  requestSection(sectionId: string, opts?: RequestOptions): SectionJob
  /** "Illustrate selection" (§8): a synthetic section of the selected blocks, with the parent as path context. */
  requestSelection(
    sel: { parentSectionId: string; blockIds: string[] },
    opts?: RequestOptions,
  ): SectionJob
}

// ---------------------------------------------------------------- kind routing

const EXTRACTOR: Record<
  Exclude<VisualKind, 'trace'>,
  { role: RoleName; schema: SchemaName }
> = {
  // The graph diagram language since extractor.graph 2.0.0 (ADR 0049); parsed into a GraphIR.
  graph: { role: 'extractor.graph', schema: 'GraphSource' },
  sequence: { role: 'extractor.mermaid', schema: 'SequenceIR' },
  state: { role: 'extractor.mermaid', schema: 'StateIR' },
  class: { role: 'extractor.mermaid', schema: 'ClassIR' },
  er: { role: 'extractor.mermaid', schema: 'ErIR' },
  template: { role: 'extractor.template', schema: 'TemplateIR' },
  chart: { role: 'extractor.chart', schema: 'ChartIR' },
  math: { role: 'extractor.math', schema: 'MathIR' },
  timeline: { role: 'extractor.timeline', schema: 'TimelineIR' },
  html: { role: 'html-fallback', schema: 'HtmlIR' },
}

/** The role whose prompt/model enters an item's visual key. */
export function roleForKind(kind: VisualKind): RoleName {
  return kind === 'trace' ? 'translator' : EXTRACTOR[kind].role
}

/** Kinds behind a feature flag (§4). */
const KIND_FLAG: Partial<Record<VisualKind, keyof Flags>> = {
  template: 'templates',
  trace: 'tracer',
  html: 'htmlFallback',
}

export function kindEnabled(kind: VisualKind, flags: Flags): boolean {
  const f = KIND_FLAG[kind]
  return !f || flags[f]
}

class ItemFailure extends Error {
  readonly code: string
  readonly report: ValidationReport | undefined
  constructor(code: string, message: string, report?: ValidationReport) {
    super(message)
    this.code = code
    this.report = report
  }
}

const emptyReport = (): ValidationReport => ({
  ok: true,
  groundingScore: 0,
  counts: { total: 0, grounded: 0, halfGrounded: 0, fuzzy: 0, dropped: 0 },
  dropped: [],
  issues: [],
  retried: false,
  escalated: false,
})

const tokensOf = (r: Pick<LlmResult<unknown>, 'usage'>) =>
  r.usage.input + r.usage.output

// ---------------------------------------------------------------- pipeline

export function createPipeline(deps: PipelineDeps): Pipeline {
  const { repos } = deps
  const llm = limitLlm(
    deps.llm,
    createLimiter(deps.maxLlmRequests ?? MAX_LLM_REQUESTS),
  )
  const sectionSlots = createLimiter(deps.maxSections ?? MAX_SECTIONS)
  const validate = deps.validate ?? defaultValidate
  const ground = deps.ground ?? defaultGround
  const now = deps.now ?? Date.now
  const flagsNow = () =>
    typeof deps.flags === 'function'
      ? deps.flags()
      : deps.flags ?? resolveFlags()
  const jobs = new Set<Job>()
  // "Catching up" progress per concept model and section, set while that item's route runs.
  const catchUp = new Map<string, (n: number) => void>()
  const conceptModels =
    deps.conceptModels ??
    createConceptModels({
      repos,
      llm: deps.llm,
      prompts: deps.prompts,
      ground,
      ...(deps.lexical && { lexical: deps.lexical }),
      onCatchUp: (e) =>
        catchUp.get(`${e.conceptModelId}|${e.sectionId}`)?.(e.count),
    }).route

  /** Expected (primary, then fallback) model runs of a role: cache lookups try each in order. */
  function expectedRuns(role: RoleName, escalate = false) {
    const promptVersion = deps.prompts.get(role).version
    return resolveRoute(deps.models, role, escalate).chain.map((m) => ({
      promptVersion,
      model: m.model,
      effort: m.effort,
    }))
  }

  async function firstHit<T>(
    keys: Promise<string>[],
    get: (k: string) => Promise<T | undefined>,
  ): Promise<T | undefined> {
    for (const k of keys) {
      const hit = await get(await k)
      if (hit) return hit
    }
    return undefined
  }

  type Listener = (p: never) => void
  class Job implements SectionJob {
    sectionId: string
    cancelled = false
    readonly controller = new AbortController()
    readonly listeners = new Map<SectionJobEvent, Set<Listener>>()
    finished: Promise<void>
    resolveFinished!: () => void

    constructor(sectionId: string) {
      this.sectionId = sectionId
      this.finished = new Promise((r) => (this.resolveFinished = r))
    }
    on<E extends SectionJobEvent>(
      event: E,
      cb: (payload: SectionJobEvents[E]) => void,
    ) {
      const set = this.listeners.get(event) ?? new Set()
      set.add(cb as Listener)
      this.listeners.set(event, set)
      return () => void set.delete(cb as Listener)
    }
    emit<E extends SectionJobEvent>(event: E, payload: SectionJobEvents[E]) {
      if (this.cancelled && event !== 'done') return
      for (const cb of this.listeners.get(event) ?? [])
        (cb as (p: SectionJobEvents[E]) => void)(payload)
    }
    cancel() {
      if (this.cancelled) return
      this.cancelled = true
      this.controller.abort()
    }
  }

  function start(
    job: Job,
    opts: RequestOptions,
    resolveSection: () => Promise<{
      section: SectionNode
      synthetic?: Block[]
      indexId: string
    }>,
  ) {
    if (opts.instruction && opts.instruction.length > MAX_INSTRUCTION_CHARS)
      throw new Error(
        `instruction is longer than ${MAX_INSTRUCTION_CHARS} characters`,
      )
    if (!opts.keepOthers)
      for (const other of jobs)
        if (other.sectionId !== job.sectionId) other.cancel()
    jobs.add(job)
    // Start on a later tick so the caller can subscribe first.
    void Promise.resolve()
      .then(() =>
        sectionSlots.run(async () =>
          job.cancelled ? undefined : runJob(job, opts, await resolveSection()),
        ),
      )
      .catch((e: unknown) => {
        if (!(e instanceof LlmError && e.code === 'aborted'))
          job.emit('error', {
            code: e instanceof LlmError ? e.code : 'internal',
            message: (e as Error)?.message ?? String(e),
          })
      })
      .finally(() => {
        jobs.delete(job)
        job.emit('done', { cancelled: job.cancelled })
        job.resolveFinished()
      })
    return job
  }

  async function runJob(
    job: Job,
    opts: RequestOptions,
    target: { section: SectionNode; synthetic?: Block[]; indexId: string },
  ) {
    const { section } = target
    const flags = flagsNow()
    const signal = job.controller.signal

    // §15 step 2: the concept index, waited for up to 20 s.
    let partialContext = false
    if (!(await repos.sectionIndex.get(target.indexId))) {
      if (deps.concepts) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<boolean>(
          (r) =>
            (timer = setTimeout(
              () => r(false),
              deps.indexWaitMs ?? INDEX_WAIT_MS,
            )),
        )
        partialContext = !(await Promise.race([
          deps.concepts.indexNow(target.indexId).catch(() => false),
          timeout,
        ]))
        clearTimeout(timer)
      } else partialContext = true
    }
    if (job.cancelled) return

    const synthetic = target.synthetic && { section, blocks: target.synthetic }
    const repo = { ...repos, ...(deps.lexical && { lexical: deps.lexical }) }

    // §15 step 3: plan. The enabled flag-gated kinds enter the key, so toggling a flag re-plans.
    const enabled = VisualKind.options.filter((k) => kindEnabled(k, flags))
    const kinds = enabled
      .filter((k) => KIND_FLAG[k])
      .sort()
      .join(',')
    const planKeys = expectedRuns('planner').map((planner) =>
      planKey({
        bookId: section.bookId,
        sectionId: section.sectionId,
        contentHash: section.contentHash,
        contextVersion: CONTEXT_VERSION,
        planner,
        kinds,
      }),
    )
    let record = opts.force
      ? undefined
      : await firstHit(planKeys, (k) => repos.plans.get(k))
    const fromCache = !!record
    if (!record) {
      const packed = await packContext({
        role: 'planner',
        sectionId: section.sectionId,
        budgetTokens: deps.prompts.get('planner').budgetTokens,
        repo,
        ...(synthetic && { synthetic }),
      })
      const available = enabled.flatMap((k) =>
        k === 'template' && deps.templates
          ? deps.templates.listTemplates().map((t) => `template:${t.id}`)
          : [k],
      )
      const parts = [
        packed.body,
        `<available_kinds>${escapeText(
          available.join(', '),
        )}</available_kinds>`,
      ]
      // Existing concept models the planner may extend (§13), only when the flag is on.
      const models = flags.conceptModels
        ? (await repos.conceptModels.listByBook(section.bookId)).sort((a, b) =>
            a.conceptModelId < b.conceptModelId ? -1 : 1,
          )
        : []
      if (models.length)
        parts.push(
          [
            '<concept_models>',
            ...models.map(
              (m) =>
                `  <concept_model${attrs([
                  ['id', m.conceptModelId],
                  ['concept', m.conceptId],
                  ['kind', m.kind],
                ])}/>`,
            ),
            '</concept_models>',
          ].join('\n'),
        )
      if (opts.force)
        parts.push(
          '<force>The reader asked for a visual of this section. Set needsVisual to true unless nothing in it can be drawn from the text.</force>',
        )
      const body = parts.join('\n')
      const res = await llm.call(
        'planner',
        { prefix: packed.prefix, body },
        { signal, bookId: section.bookId, sectionId: section.sectionId },
      )
      const plan: VisualPlan = { ...res.data, sectionId: section.sectionId }
      record = {
        cacheKey: await planKey({
          bookId: section.bookId,
          sectionId: section.sectionId,
          contentHash: section.contentHash,
          contextVersion: CONTEXT_VERSION,
          planner: {
            promptVersion: res.promptVersion,
            model: res.model,
            effort: res.effort,
          },
          kinds,
        }),
        bookId: section.bookId,
        sectionId: section.sectionId,
        plan,
        partialContext,
        model: res.model,
        effort: res.effort,
        promptVersion: res.promptVersion,
        usageTokens: tokensOf(res),
        createdAt: now(),
        stale: false,
      }
      await repos.plans.put(record)
    }
    if (job.cancelled) return
    const plan = record.plan
    const items = plan.items
      .filter((i) => !opts.planItemId || i.planItemId === opts.planItemId)
      .map((i) => (opts.kindOverride ? overrideKind(i, opts.kindOverride) : i))
      .filter((i) => kindEnabled(i.kind, flags))
      .sort((a, b) => a.priority - b.priority)
    job.emit('plan', {
      plan: { ...plan, items },
      record,
      partialContext: record.partialContext,
      fromCache,
    })
    if (!plan.needsVisual) {
      job.emit('no-visual', { reason: plan.reason })
      return
    }
    const off = [
      ...new Set(
        plan.items.flatMap((i) =>
          kindEnabled(i.kind, flags) ? [] : [KIND_FLAG[i.kind]!],
        ),
      ),
    ]
    if (!items.length) {
      job.emit('no-visual', {
        reason: off.length
          ? `The planned visuals need features that are turned off: ${off.join(
              ', ',
            )}. Turn them on in Illustrate settings.`
          : 'The plan has no visual to draw for this section.',
      })
      return
    }

    // §15 step 5 as amended by ADR 0054: every item starts at once (the global request limiter still
    // caps calls in flight, FIFO in priority order). Items that patch the same concept model run one
    // after another, so neither reads the model while the other is writing it.
    const runOne = async (item: PlanItem) => {
      if (job.cancelled) return
      try {
        await runItem(job, item, record, section, synthetic, opts, flags)
      } catch (e) {
        if (e instanceof LlmError && e.code === 'aborted') return
        const f =
          e instanceof ItemFailure
            ? e
            : new ItemFailure(
                e instanceof LlmError ? e.code : 'internal',
                (e as Error)?.message ?? String(e),
              )
        job.emit('item-failed', {
          planItemId: item.planItemId,
          code: f.code,
          message: f.message,
          ...(f.report && { report: f.report }),
        })
      }
    }
    for (const i of items)
      job.emit('item-progress', { planItemId: i.planItemId, stage: 'queued' })
    const chains = new Map<string, Promise<void>>()
    await Promise.all(
      items.map((i) => {
        const model = i.conceptModelId ?? i.newConceptModel
        if (!model) return runOne(i)
        const run = (chains.get(model) ?? Promise.resolve()).then(() =>
          runOne(i),
        )
        chains.set(model, run)
        return run
      }),
    )
  }

  async function runItem(
    job: Job,
    item: PlanItem,
    plan: PlanRecord,
    section: SectionNode,
    synthetic: { section: SectionNode; blocks: Block[] } | undefined,
    opts: RequestOptions,
    flags: Flags,
  ) {
    const progress = (stage: ItemStage) =>
      job.emit('item-progress', { planItemId: item.planItemId, stage })
    /** Called before every further step: a cancelled job starts no new call. */
    const stopIfCancelled = () => {
      if (job.cancelled) throw new LlmError('aborted', 'job cancelled')
    }
    if (item.kind === 'template' && !item.templateId)
      throw new ItemFailure(
        'needs-template',
        'a template item needs a templateId',
      )
    const role = roleForKind(item.kind)
    const instruction = opts.instruction?.trim() || undefined
    const keys = expectedRuns(role).map((extractor) =>
      visualKey({
        planKey: plan.cacheKey,
        planItem: item,
        extractor,
        compilerVersion: COMPILER_VERSION,
        ...(instruction && { instruction }),
      }),
    )
    const hit = await firstHit(keys, (k) => repos.visuals.get(k))
    if (hit) {
      progress('cached')
      job.emit('item-ready', {
        planItemId: item.planItemId,
        record: hit,
        fromCache: true,
      })
      return
    }

    const repo = { ...repos, ...(deps.lexical && { lexical: deps.lexical }) }
    let packed = await packContext({
      role,
      sectionId: section.sectionId,
      planItem: item,
      budgetTokens: deps.prompts.get(role).budgetTokens,
      repo,
      ...(synthetic && { synthetic }),
    })
    const blocks = new Map(
      (await repos.blocks.bulkGet(packed.usedBlockIds)).flatMap((b) =>
        b ? [[b.blockId, b] as const] : [],
      ),
    )
    if (synthetic) for (const b of synthetic.blocks) blocks.set(b.blockId, b)
    const extra = [
      item.kind === 'template' && item.templateId
        ? templateBlock(item.templateId)
        : '',
      instruction
        ? `<user_instruction>${escapeText(instruction)}</user_instruction>`
        : '',
    ].filter(Boolean)
    let ctx = {
      prefix: packed.prefix,
      body: [packed.body, ...extra].join('\n'),
    }
    const callOpts = {
      bookId: section.bookId,
      sectionId: section.sectionId,
      signal: job.controller.signal,
    }
    const validationContext = async (): Promise<ValidationContext> => ({
      blocks,
      ground,
      ...(deps.templates && { templates: deps.templates }),
      aliases: await aliasMap(section.bookId),
    })

    let ir: unknown = null
    let report: ValidationReport = emptyReport()
    let kind: VisualKind = item.kind
    let usage = 0
    const promptVersions: Record<string, string> = {}
    const models: Record<string, string> = {}
    const note = (r: RoleName, res: LlmResult<unknown>) => {
      promptVersions[r] = res.promptVersion
      models[r] = `${res.model}@${res.effort}`
      usage += tokensOf(res)
    }
    let traceKeyOut: string | undefined
    let routeItem = item
    let simulatedReason: string | undefined
    let storeRun = expectedRuns(role)[0]!

    if (item.kind === 'trace') {
      progress('tracing')
      const t = await traceRoute(
        item,
        packed,
        callOpts,
        note,
        job.controller.signal,
        flags,
      )
      storeRun = t.run
      if ('traceKey' in t) {
        traceKeyOut = t.traceKey
        ;({ ir, report } = { ir: null, report: emptyReport() })
      } else {
        routeItem = t.item
        kind = routeItem.kind
        simulatedReason = t.reason
        const fallbackRole = roleForKind(kind)
        packed = await packContext({
          role: fallbackRole,
          sectionId: section.sectionId,
          planItem: routeItem,
          budgetTokens: deps.prompts.get(fallbackRole).budgetTokens,
          repo,
          ...(synthetic && { synthetic }),
        })
        blocks.clear()
        for (const b of await repos.blocks.bulkGet(packed.usedBlockIds))
          if (b) blocks.set(b.blockId, b)
        if (synthetic)
          for (const b of synthetic.blocks) blocks.set(b.blockId, b)
        ctx = {
          prefix: packed.prefix,
          body: [
            packed.body,
            routeItem.templateId ? templateBlock(routeItem.templateId) : '',
            `<trace_fallback mode="simulated">${escapeText(
              t.reason,
            )}</trace_fallback>`,
            instruction
              ? `<user_instruction>${escapeText(
                  instruction,
                )}</user_instruction>`
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
        }
      }
    }
    if (
      !traceKeyOut &&
      flags.conceptModels &&
      (routeItem.conceptModelId || routeItem.newConceptModel)
    ) {
      progress('patching')
      const key = `${conceptModelIdOf(item)}|${section.sectionId}`
      catchUp.set(key, (n) =>
        job.emit('item-progress', {
          planItemId: item.planItemId,
          stage: 'catching-up',
          sections: n,
        }),
      )
      const out = await conceptModels({
        planItem: item,
        section,
        context: packed,
        llm,
      }).finally(() => catchUp.delete(key))
      ;({ ir, report, kind } = out)
      Object.assign(promptVersions, out.promptVersions)
      Object.assign(models, out.models)
      usage += out.usageTokens
    } else if (!traceKeyOut) {
      const { role: exRole, schema } =
        EXTRACTOR[routeItem.kind as Exclude<VisualKind, 'trace'>]
      const attempt = async (feedback: string, escalate: boolean) => {
        const body = feedback ? `${ctx.body}\n${feedback}` : ctx.body
        try {
          const res = await llm.call(
            exRole,
            { prefix: ctx.prefix, body },
            {
              ...callOpts,
              schemaName: schema as never,
              ...(routeItem.kind === 'template' &&
                routeItem.templateId && { templateId: routeItem.templateId }),
              ...(escalate && { escalate }),
            },
          )
          note(exRole, res)
          if (item.kind !== 'trace')
            storeRun = {
              promptVersion: res.promptVersion,
              model: res.model,
              effort: res.effort,
            }
          const vctx = await validationContext()
          return schema === 'GraphSource'
            ? validateGraphSource(res.data, vctx, validate)
            : validate(routeItem.kind, res.data, vctx)
        } catch (e) {
          // An L1 schema failure is treated like an unusable extraction: retried, then escalated.
          if (e instanceof LlmError && e.code === 'schema') {
            const r = emptyReport()
            return {
              ir: undefined,
              report: {
                ...r,
                ok: false,
                issues: [
                  {
                    layer: 'schema' as const,
                    severity: 'error' as const,
                    code: 'schema',
                    message: e.message,
                  },
                ],
              },
            }
          }
          throw e
        }
      }
      // Any remaining error (e.g. a duplicate label) is worth one retry with the report, not only heavy drops.
      const unusable = (r: ValidationReport, out: unknown) =>
        out === undefined || needsReextract(r) || !r.ok
      progress('extracting')
      let v = await attempt('', false)
      let retried = false
      let escalated = false
      if (unusable(v.report, v.ir)) {
        stopIfCancelled()
        progress('retrying')
        retried = true
        v = await attempt(reportBlock(v.report), false)
        if (
          unusable(v.report, v.ir) &&
          (ROLES[exRole] as RoleSpec).escalationTier
        ) {
          stopIfCancelled()
          progress('escalating')
          escalated = true
          v = await attempt(reportBlock(v.report), true)
        }
      }
      report = { ...v.report, retried, escalated }
      if (unusable(report, v.ir) || !report.ok)
        throw new ItemFailure(
          'validation',
          'the extracted IR failed validation',
          report,
        )
      ir = v.ir
    }
    if (simulatedReason)
      report = {
        ...report,
        issues: [
          ...report.issues,
          {
            layer: 'structure',
            severity: 'warning',
            code: 'trace-simulated',
            message: simulatedReason,
          },
        ],
      }

    const cacheKey = await visualKey({
      planKey: plan.cacheKey,
      planItem: item,
      extractor: storeRun,
      compilerVersion: COMPILER_VERSION,
      ...(instruction && { instruction }),
    })
    const willAnimate =
      routeItem.animate && flags.animations && kind !== 'trace'
    if ((willAnimate || deps.review) && !job.cancelled)
      job.emit('item-preview', {
        planItemId: item.planItemId,
        record: {
          cacheKey,
          bookId: section.bookId,
          sectionId: section.sectionId,
          planItemId: item.planItemId,
          kind,
          ir,
          spec: null,
          ...(traceKeyOut && { traceKey: traceKeyOut }),
          validation: report,
          promptVersions: { ...promptVersions },
          models: { ...models },
          usageTokens: usage,
          createdAt: now(),
          stale: false,
          ...(instruction && { instruction }),
        },
      })

    // §15 step 7: animate when asked and enabled.
    let animation: AnimationIR | undefined
    if (willAnimate) {
      stopIfCancelled()
      progress('animating')
      try {
        const res = await llm.call(
          'animator',
          {
            prefix: ctx.prefix,
            body: `${ctx.body}\n<ir>${escapeText(
              JSON.stringify(ir),
            )}</ir>${animatorTargets(ir)}`,
          },
          callOpts,
        )
        note('animator', res)
        let candidate = res.data
        let issues = deps.validateAnimation?.(ir, candidate, { blocks }) ?? []
        if (issues.some((issue) => issue.severity === 'error')) {
          // §11: exactly one repair, charged/logged through the same request limiter. Revalidation
          // uses the same block whitelist; a repair never gains evidence from later book sections.
          stopIfCancelled()
          progress('retrying')
          try {
            const fixed = await llm.call(
              'repair',
              {
                prefix: ctx.prefix,
                body: `${ctx.body}\n<ir>${escapeText(
                  JSON.stringify(ir),
                )}</ir>\n<animation>${escapeText(
                  JSON.stringify(candidate),
                )}</animation>\n<animation_issues>${escapeText(
                  JSON.stringify(issues),
                )}</animation_issues>`,
              },
              { ...callOpts, schemaName: 'AnimationIR' },
            )
            note('repair', fixed)
            candidate = fixed.data
            issues = deps.validateAnimation?.(ir, candidate, { blocks }) ?? []
          } catch (error) {
            if (
              error instanceof LlmError &&
              (error.code === 'aborted' || error.code === 'plan-limit')
            )
              throw error
            issues = [
              ...issues,
              {
                layer: 'animation',
                severity: 'error',
                code: 'animation-repair-failed',
                message: (error as Error).message,
              },
            ]
          }
        }
        if (issues.some((i) => i.severity === 'error'))
          report = {
            ...report,
            issues: [
              ...report.issues,
              ...issues.map((i) => ({ ...i, severity: 'warning' as const })),
            ],
          }
        else animation = candidate
      } catch (e) {
        if (
          e instanceof LlmError &&
          (e.code === 'aborted' || e.code === 'plan-limit')
        )
          throw e
        report = {
          ...report,
          issues: [
            ...report.issues,
            {
              layer: 'animation',
              severity: 'warning',
              code: 'animation-failed',
              message: (e as Error).message,
            },
          ],
        }
      }
      const fallbackGraph = !animation ? GraphIR.safeParse(ir) : undefined
      if (fallbackGraph?.success) {
        stopIfCancelled()
        try {
          const candidate = defaultStoryboard(
            fallbackGraph.data,
            item.planItemId,
          )
          const issues = candidate
            ? deps.validateAnimation?.(ir, candidate, { blocks }) ?? []
            : []
          stopIfCancelled()
          if (candidate && !issues.some((i) => i.severity === 'error')) {
            animation = candidate
            report = {
              ...report,
              issues: [
                ...report.issues,
                {
                  layer: 'animation',
                  severity: 'warning',
                  code: 'animation-fallback',
                  message:
                    'Animator output was unusable; showed the graph in flow order instead.',
                },
              ],
            }
          }
        } catch (error) {
          if (
            error instanceof LlmError &&
            (error.code === 'aborted' || error.code === 'plan-limit')
          )
            throw error
          // The fallback is best effort: keep the static visual and original animation warnings.
        }
      }
    }

    progress('storing')
    let record: VisualRecord = {
      cacheKey,
      bookId: section.bookId,
      sectionId: section.sectionId,
      planItemId: item.planItemId,
      kind,
      ir,
      spec: null,
      ...(animation && { animation }),
      ...(traceKeyOut && { traceKey: traceKeyOut }),
      validation: report,
      promptVersions,
      models,
      usageTokens: usage,
      createdAt: now(),
      stale: false,
      ...(instruction && { instruction }),
    }
    if (deps.review) {
      progress('critic')
      const unreviewed = record
      record = await deps
        .review(record, {
          context: ctx,
          validation: await validationContext(),
          planItem: routeItem,
          signal: job.controller.signal,
        })
        .catch(() => unreviewed)
    }
    await repos.visuals.put(record)
    job.emit('item-ready', {
      planItemId: item.planItemId,
      record,
      fromCache: false,
    })
  }

  async function traceRoute(
    item: PlanItem,
    packed: PackedContext,
    callOpts: { bookId: string; sectionId: string; signal: AbortSignal },
    note: (r: RoleName, res: LlmResult<unknown>) => void,
    signal: AbortSignal,
    flags: Flags,
  ) {
    if (!deps.traceRunner)
      throw new ItemFailure('unavailable', 'no trace runner')
    const code = item.codeBlockId
      ? await repos.blocks.get(item.codeBlockId)
      : undefined
    if (!code)
      throw new ItemFailure(
        'missing-code-block',
        `code block ${item.codeBlockId} not found`,
      )
    if (!packed.usedBlockIds.includes(code.blockId))
      throw new ItemFailure(
        'trace-code-outside-context',
        `code block ${code.blockId} is not permitted by this section's context`,
      )
    if (code.kind !== 'code')
      throw new ItemFailure(
        'trace-not-code',
        `block ${code.blockId} is not a code listing`,
      )
    const source = code.code?.source ?? code.text
    const body = `${packed.body}\n<trace_source${attrs([
      ['block_id', code.blockId],
      ['lang', code.code?.langHint],
    ])}>${escapeText(source)}</trace_source>`
    const tracerVersion = deps.tracerVersion ?? 1
    const existing = await firstHit(
      expectedRuns('translator').map((translator) =>
        traceKey({ codeSource: source, translator, tracerVersion }),
      ),
      (k) => repos.traces.get(k),
    )
    if (existing)
      return {
        traceKey: existing.cacheKey,
        run: {
          promptVersion: existing.promptVersions.translator!,
          model: existing.models.translator!,
          effort: existing.efforts.translator!,
        },
      }
    const res = await llm.call(
      'translator',
      { prefix: packed.prefix, body },
      callOpts,
    )
    const promptVersions: Record<string, string> = {}
    const models: Record<string, string> = {}
    const efforts: Record<string, LlmResult<unknown>['effort']> = {}
    const account = (role: RoleName, result: LlmResult<unknown>) => {
      note(role, result)
      promptVersions[role] = result.promptVersion
      models[role] = result.model
      efforts[role] = result.effort
    }
    account('translator', res)
    const used = {
      promptVersion: res.promptVersion,
      model: res.model,
      effort: res.effort,
    }
    let translation = Translation.parse(res.data)
    let repairs = 0
    const fallbackItem = (
      route: 'timeline' | 'none' | 'simulated-template',
      reason: string,
    ) => {
      if (signal.aborted) throw new LlmError('aborted', 'trace job cancelled')
      if (route === 'none') throw new ItemFailure('trace-unsupported', reason)
      if (route === 'timeline')
        return {
          run: used,
          reason,
          item: { ...overrideKind(item, 'timeline'), animate: false },
        }
      const templateId = translation.vizHints[0]?.template
      if (!flags.templates || !flags.animations || !templateId)
        throw new ItemFailure(
          'trace-fallback-unavailable',
          `${reason} Simulated walkthrough needs templates, animations and a translator template hint.`,
        )
      return {
        run: used,
        reason,
        item: { ...overrideKind(item, 'template'), templateId, animate: true },
      }
    }
    let scenarios
    for (;;) {
      if (signal.aborted) throw new LlmError('aborted', 'trace job cancelled')
      if (!translation.traceable) {
        const reason =
          translation.reason ??
          'The code cannot be executed by the trace worker.'
        return fallbackItem(
          /concurr|thread|goroutine|async|parallel|distributed/i.test(reason)
            ? 'timeline'
            : 'none',
          reason,
        )
      }
      try {
        scenarios = await deps.traceRunner.runTrace(
          { codeBlockId: code.blockId, translation },
          { signal },
        )
        break
      } catch (error) {
        if (signal.aborted) throw new LlmError('aborted', 'trace job cancelled')
        // W7's structural error seam avoids any runtime dependency on the worker package.
        const failure = error as {
          code?: string
          route?: string
          reason?: string
          translation?: unknown
          repairs?: number
        }
        if (
          failure?.code !== 'trace-fallback' ||
          !['timeline', 'none', 'simulated-template'].includes(
            failure.route ?? '',
          ) ||
          typeof failure.reason !== 'string'
        )
          throw error
        const parsed = Translation.safeParse(failure.translation)
        if (!parsed.success) throw error
        translation = parsed.data
        repairs = Math.max(
          repairs,
          Number.isInteger(failure.repairs) ? failure.repairs! : 0,
        )
        if (failure.route !== 'simulated-template' || repairs >= 2)
          return fallbackItem(
            failure.route as 'timeline' | 'none' | 'simulated-template',
            failure.reason,
          )
        const fixed = await llm.call(
          'trace-fixer',
          {
            prefix: packed.prefix,
            body: `${body}\n<translation>${escapeText(
              JSON.stringify(translation),
            )}</translation>\n<trace_error attempt="${
              repairs + 1
            }">${escapeText(failure.reason)}</trace_error>`,
          },
          { ...callOpts, signal },
        )
        account('trace-fixer', fixed)
        translation = Translation.parse(fixed.data)
        repairs++
      }
    }
    if (!scenarios.length || scenarios.some((s) => s.trace.error))
      throw new ItemFailure(
        'trace-execution',
        'The runner returned no successful execution scenarios.',
      )
    const key = await traceKey({
      codeSource: source,
      translator: used,
      tracerVersion,
    })
    await repos.traces.put({
      cacheKey: key,
      bookId: callOpts.bookId,
      codeBlockId: code.blockId,
      translation,
      scenarios,
      mode: 'executed',
      promptVersions,
      models,
      efforts,
      createdAt: now(),
      stale: false,
    })
    return { traceKey: key, run: used }
  }

  /** Canonical name → aliases for the relevance check; read per call because the concept pass may still be running. */
  async function aliasMap(bookId: string) {
    return new Map(
      (await repos.concepts.listByBook(bookId)).map((c) => [
        c.canonical,
        c.aliases,
      ]),
    )
  }

  /** `<targets>` and `<supported_actions>` in the tags of docs/prompts/animator.md; empty when they cannot be resolved (e.g. no template registry), leaving it to animation validation. */
  function animatorTargets(ir: unknown): string {
    try {
      const { targets, supportedActions } = animationTargets(
        ir as IR,
        deps.templates ? { templates: deps.templates } : {},
      )
      return `<targets>${escapeText(
        targets.join(', '),
      )}</targets><supported_actions>${escapeText(
        supportedActions.join(','),
      )}</supported_actions>`
    } catch {
      return ''
    }
  }

  function templateBlock(id: NonNullable<PlanItem['templateId']>): string {
    const t = deps.templates?.getTemplate(id)
    if (!t) return `<template${attrs([['id', id]])}/>`
    return [
      `<template${attrs([['id', id]])}>`,
      `<description>${escapeText(t.description)}</description>`,
      `<when_to_use>${escapeText(t.whenToUse)}</when_to_use>`,
      `<example>${escapeText(JSON.stringify(t.example))}</example>`,
      '</template>',
    ].join('\n')
  }

  return {
    requestSection(sectionId, opts = {}) {
      const job = new Job(sectionId)
      return start(job, opts, async () => {
        let section = await repos.sections.get(sectionId)
        if (!section)
          throw new LlmError('upstream', `unknown section ${sectionId}`)
        // §15 step 1: tiny sections are generated with the section they were merged into.
        const seen = new Set<string>()
        while (section.mergedInto && !seen.has(section.sectionId)) {
          seen.add(section.sectionId)
          const into: SectionNode | undefined = await repos.sections.get(
            section.mergedInto,
          )
          if (!into) break
          section = into
        }
        job.sectionId = section.sectionId
        return { section, indexId: section.sectionId }
      })
    },

    requestSelection({ parentSectionId, blockIds }, opts = {}) {
      const job = new Job(`${parentSectionId}~sel`)
      return start(job, opts, async () => {
        const parent = await repos.sections.get(parentSectionId)
        if (!parent)
          throw new LlmError('upstream', `unknown section ${parentSectionId}`)
        const blocks = (await repos.blocks.bulkGet(blockIds)).filter(
          (b): b is Block => !!b,
        )
        if (!blocks.length)
          throw new LlmError('upstream', 'the selection has no known blocks')
        const contentHash = await sectionContentHash(blocks.map((b) => b.text))
        const section: SectionNode = {
          ...parent,
          sectionId: `${parent.sectionId}~sel-${(
            await sha256Hex(blockIds.join('\n'))
          ).slice(0, 12)}`,
          title: `${parent.title} (selection)`,
          parentId: parent.sectionId,
          childIds: [],
          blockIds: blocks.map((b) => b.blockId),
          contentHash,
          tokenEstimate: Math.ceil(
            blocks.reduce((n, b) => n + b.text.length, 0) / 3.6,
          ),
          cfiStart: blocks[0]!.cfiRange,
          cfiEnd: blocks.at(-1)!.cfiRange,
        }
        delete section.mergedInto
        job.sectionId = section.sectionId
        return { section, synthetic: blocks, indexId: parent.sectionId }
      })
    },
  }
}

/** Kind override (§8): the item with another kind; fields that do not fit the new kind are dropped. */
export function overrideKind(item: PlanItem, kind: VisualKind): PlanItem {
  const out: PlanItem = { ...item, kind }
  if (kind !== 'template') delete out.templateId
  if (!ConceptModelKind.safeParse(kind).success) {
    delete out.conceptModelId
    delete out.newConceptModel
  }
  return out
}

/**
 * ADR 0049: parses the graph extractor's diagram source, validates the resulting GraphIR, and folds the
 * parse issues into the report. A statement that does not parse is dropped like an ungrounded element:
 * counted in `dropped`, kept as an auto-fixed warning, and quoted back to the model on a retry. A source
 * with no usable node is an error.
 */
export function validateGraphSource(
  data: unknown,
  ctx: ValidationContext,
  validate: Validator,
): ValidationResult {
  const fail = (issues: ValidationIssue[]): ValidationResult => {
    const r = emptyReport()
    return { ir: undefined, report: { ...r, ok: false, issues } }
  }
  const wrapper = GraphSource.safeParse(data)
  if (!wrapper.success)
    return fail([
      {
        layer: 'schema',
        severity: 'error',
        code: 'schema',
        message: wrapper.error.issues.map((i) => i.message).join('; '),
      },
    ])
  const parsed = parseGraphSource(wrapper.data.source, ctx.blocks)
  if (!parsed.ir) return fail(parsed.issues)
  const v = validate('graph', parsed.ir, ctx)
  const dropped = parsed.issues.filter((i) => i.severity === 'error')
  const issues = parsed.issues.map(
    (i): ValidationIssue =>
      i.severity === 'error'
        ? { ...i, severity: 'warning', autoFixed: true }
        : i,
  )
  return {
    ir: v.ir,
    report: {
      ...v.report,
      counts: {
        ...v.report.counts,
        total: v.report.counts.total + dropped.length,
        dropped: v.report.counts.dropped + dropped.length,
      },
      issues: [...issues, ...v.report.issues],
    },
  }
}

/** The validator report attached to a retry (§8 stage 3 step 3). */
export function reportBlock(report: ValidationReport): string {
  const issues = report.issues
    .filter(
      (i) =>
        i.severity === 'error' ||
        i.code === 'quote-not-found' ||
        (i.code.startsWith('dsl-') && i.autoFixed),
    )
    .map(
      (i) =>
        `  <issue${attrs([
          ['code', i.code],
          ['element', i.elementId],
        ])}>${escapeText(i.message)}</issue>`,
    )
  return [
    `<validator_report${attrs([
      ['dropped', report.counts.dropped],
      ['total', report.counts.total],
    ])}>`,
    ...issues,
    '  <retry>Your previous answer failed these checks. Answer again: quote verbatim from the blocks, keep every element grounded, and keep enough elements for the plan item.</retry>',
    '</validator_report>',
  ].join('\n')
}
