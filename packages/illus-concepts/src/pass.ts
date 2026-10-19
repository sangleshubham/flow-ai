// The concept pass (§6 phase B): background indexer batches, glossary merge, book summary. Resumable:
// progress is the stored SectionIndex records plus per-book gaps in settings (ADR 0061).
import { LlmError, ground as defaultGround } from '@illus/core'
import type {
  Block,
  BookMeta,
  ConceptMerge,
  GroundingFn,
  IllusRepos,
  LlmCall,
  SectionIndexOutput,
  SectionIndexRecord,
  SectionNode,
} from '@illus/core'
import {
  attrs,
  escapeText,
  estimateTokens,
  renderSection,
} from '@illus/context'

import {
  ambiguousGroups,
  clusterConcepts,
  nameKey,
  toConcepts,
} from './cluster.ts'
import { prioritize, takeBatch } from './queue.ts'

/** Glossary merge after this many newly indexed sections (§6 phase B step 5). */
export const GLOSSARY_EVERY = 15
/** Book summary once this share of sections is indexed (§6 phase B step 6). */
export const SUMMARY_AT = 0.1
/** Input budget of the book-summary call; deeper levels are left out first above it. */
export const SUMMARY_BUDGET_TOKENS = 12_000
/** Consecutive batches failing on both tiers before treating the network/service as unavailable. */
export const MAX_TRANSIENT_BATCHES_IN_A_ROW = 3

export const conceptPassStateKey = (bookId: string) => `conceptPass:${bookId}`

/** Re-index callers clear pass gaps after deleting the book's section indexes. */
export async function resetConceptPassState(
  repos: Pick<IllusRepos, 'settings'>,
  bookId: string,
): Promise<void> {
  await repos.settings.delete(conceptPassStateKey(bookId))
}

export type ConceptPassGap = 'glossary' | 'book-summary'

export type ConceptRepos = Pick<
  IllusRepos,
  | 'books'
  | 'sections'
  | 'blocks'
  | 'sectionIndex'
  | 'concepts'
  | 'settings'
  | 'transaction'
>

export interface ConceptPassDeps {
  bookId: string
  repos: ConceptRepos
  llm: LlmCall
  ground?: GroundingFn
  now?: () => number
  glossaryEvery?: number
  onProgress?: (p: ConceptPassProgress) => void
}

export interface ConceptPassProgress {
  indexed: number
  total: number
  done: boolean
  /** Set when the pass stopped on an error (e.g. `plan-limit`); `start()` resumes. */
  error?: LlmError
  /**
   * Persisted schema failures and sections omitted by a batch. Resume and automatic `indexNow` skip them;
   * `retryGaps()` or `indexNow` with `retryFailed` explicitly retries them (ADR 0061).
   */
  failed?: number
  /** Optional context omitted after a model failure; does not prevent `done`. */
  gaps?: ConceptPassGap[]
}

export interface ConceptPass {
  /** Resumes pending work, skipping remembered gaps. Idempotent while running. */
  start(): Promise<ConceptPassProgress>
  /** Explicit later pass: retries remembered gaps once (with the usual indexer escalation). */
  retryGaps(): Promise<ConceptPassProgress>
  /** Pauses after aborting the in-flight call (book closed, §6 phase B step 7). */
  pause(): void
  /** Re-prioritise around the open section (§6 phase B step 1). */
  setOpenSection(sectionId: string | null): void
  /** Jumps the queue. Remembered failures resolve false unless `retryFailed` is explicitly set. */
  indexNow(
    sectionId: string,
    options?: { retryFailed?: boolean },
  ): Promise<boolean>
  progress(): Promise<ConceptPassProgress>
}

const CONTEXT_STEPS: ConceptPassGap[] = ['glossary', 'book-summary']
const TRANSIENT_CODES = new Set(['upstream', 'timeout'])
const BLOCKING_CODES = new Set([
  'plan-limit',
  'signin-required',
  'auth',
  'aborted',
])

interface PassState {
  version: 1
  indexVersion: number
  failedSectionIds: string[]
  gaps: Partial<Record<ConceptPassGap, { code: string; message: string }>>
}

const emptyState = (indexVersion: number): PassState => ({
  version: 1,
  indexVersion,
  failedSectionIds: [],
  gaps: {},
})

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Settings are untrusted; ignore malformed or structurally obsolete pass state. */
function parseState(value: unknown, indexVersion: number): PassState {
  const state = emptyState(indexVersion)
  if (
    !isObject(value) ||
    value.version !== 1 ||
    value.indexVersion !== indexVersion
  )
    return state
  if (Array.isArray(value.failedSectionIds))
    state.failedSectionIds = [
      ...new Set(
        value.failedSectionIds.filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        ),
      ),
    ]
  if (isObject(value.gaps))
    for (const step of CONTEXT_STEPS) {
      const gap = value.gaps[step]
      if (
        isObject(gap) &&
        typeof gap.code === 'string' &&
        typeof gap.message === 'string'
      )
        state.gaps[step] = { code: gap.code, message: gap.message }
    }
  return state
}

const EMPTY_FLAGS: SectionIndexOutput['flags'] = {
  algorithm: false,
  protocol: false,
  architecture: false,
  dataStructure: false,
  stateMachine: false,
  math: false,
  codeHeavy: false,
  narrative: false,
}

export function createConceptPass(deps: ConceptPassDeps): ConceptPass {
  const { bookId, repos, llm } = deps
  const ground = deps.ground ?? defaultGround
  const now = deps.now ?? Date.now
  const glossaryEvery = deps.glossaryEvery ?? GLOSSARY_EVERY
  let running: Promise<ConceptPassProgress> | null = null
  let controller: AbortController | null = null
  let openSectionId: string | null = null
  const urgent: string[] = []
  const waiters = new Map<string, ((ok: boolean) => void)[]>()
  const stateKey = conceptPassStateKey(bookId)
  let state = emptyState(0)
  let sinceGlossary = 0
  const skippedThisRun = new Set<string>()
  let transientBatchesInARow = 0

  async function readState(): Promise<PassState> {
    const book = await repos.books.get(bookId)
    return parseState(
      await repos.settings.get(stateKey),
      book?.indexVersion ?? 0,
    )
  }

  const saveState = () => repos.settings.set(stateKey, state)

  async function progress(error?: LlmError): Promise<ConceptPassProgress> {
    const [total, indexed, book, saved] = await Promise.all([
      repos.sections.listByBook(bookId).then((s) => s.length),
      repos.sectionIndex.countByBook(bookId),
      repos.books.get(bookId),
      readState(),
    ])
    const gaps = CONTEXT_STEPS.filter((step) => saved.gaps[step])
    return {
      indexed,
      total,
      done: book?.indexStatus === 'complete',
      ...(error && { error }),
      ...(saved.failedSectionIds.length > 0 && {
        failed: saved.failedSectionIds.length,
      }),
      ...(gaps.length > 0 && { gaps }),
    }
  }

  async function report() {
    deps.onProgress?.(await progress())
  }

  /** Content/service failures are gaps, while limits, authentication and cancellation still stop. */
  async function optionalStep(step: ConceptPassGap, signal: AbortSignal) {
    if (state.gaps[step]) return
    let called: boolean
    try {
      called =
        step === 'glossary'
          ? await mergeGlossary(signal)
          : await summarize(signal)
    } catch (e) {
      if (!(e instanceof LlmError) || BLOCKING_CODES.has(e.code)) throw e
      state.gaps[step] = { code: e.code, message: e.message }
      await saveState()
      called = true
    }
    if (called) await report()
  }

  function settle(sectionId: string, ok: boolean) {
    for (const w of waiters.get(sectionId) ?? []) w(ok)
    waiters.delete(sectionId)
  }

  async function run(retryGaps = false): Promise<ConceptPassProgress> {
    controller = new AbortController()
    const signal = controller.signal
    skippedThisRun.clear()
    transientBatchesInARow = 0
    try {
      state = await readState()
      if (retryGaps) {
        if (
          !state.failedSectionIds.length &&
          !CONTEXT_STEPS.some((step) => state.gaps[step])
        )
          return await progress()
        // Reset inside the reserved run: start()/Resume cannot launch a competing run during writes.
        await repos.transaction(['books', 'settings'], async () => {
          const book = await repos.books.get(bookId)
          state = emptyState(book?.indexVersion ?? 0)
          await saveState()
          if (book)
            await repos.books.put({
              ...book,
              indexStatus: 'structural',
              updatedAt: now(),
            })
        })
        sinceGlossary = 0
      }
      // Keep persisted failures scoped to sections that still exist and still lack an index.
      const sections = await repos.sections.listByBook(bookId)
      const indexed = new Set(
        (await repos.sectionIndex.listByBook(bookId)).map((r) => r.sectionId),
      )
      state.failedSectionIds = state.failedSectionIds.filter(
        (id) => sections.some((s) => s.sectionId === id) && !indexed.has(id),
      )
      await saveState()
      for (;;) {
        if (signal.aborted)
          return await progress(new LlmError('aborted', 'aborted'))
        const sections = await repos.sections.listByBook(bookId)
        const indexed = new Set(
          (await repos.sectionIndex.listByBook(bookId)).map((r) => r.sectionId),
        )
        const pending = sections.filter(
          (s) =>
            !indexed.has(s.sectionId) &&
            !skippedThisRun.has(s.sectionId) &&
            (!state.failedSectionIds.includes(s.sectionId) ||
              urgent.includes(s.sectionId)),
        )
        if (!pending.length) {
          const book = await repos.books.get(bookId)
          // Indexer and optional context gaps do not block illustration (ADR 0061).
          if (book && book.indexStatus !== 'complete') {
            await optionalStep('glossary', signal)
            await optionalStep('book-summary', signal)
            if (signal.aborted) throw new LlmError('aborted', 'aborted')
            await repos.books.put({
              ...(await repos.books.get(bookId))!,
              indexStatus: 'complete',
              updatedAt: now(),
            })
            await report()
          }
          return await progress()
        }
        const open = sections.find((s) => s.sectionId === openSectionId)
        const batch = takeBatch(prioritize(pending, open, urgent))
        const book = await repos.books.get(bookId)
        if (book?.indexStatus === 'complete')
          await repos.books.put({
            ...book,
            indexStatus: 'structural',
            updatedAt: now(),
          })
        const done = await indexBatch(batch, signal)
        sinceGlossary += done
        const p = await progress()
        if (sinceGlossary >= glossaryEvery) {
          await optionalStep('glossary', signal)
          sinceGlossary = 0
        }
        if (
          !(await repos.books.get(bookId))?.summary &&
          p.indexed / p.total >= SUMMARY_AT
        )
          await optionalStep('book-summary', signal)
      }
    } catch (e) {
      if (e instanceof LlmError) {
        const p = await progress(e)
        deps.onProgress?.(p)
        return p
      }
      throw e
    } finally {
      controller = null
      running = null
      for (const id of [...waiters.keys()]) settle(id, false)
    }
  }

  /** Indexes one batch; returns how many sections got an index. */
  async function indexBatch(
    batch: SectionNode[],
    signal: AbortSignal,
  ): Promise<number> {
    const blocksBySection = new Map<string, Block[]>()
    for (const s of batch) {
      // Next 12's async lowering can concatenate awaited arrays into call arguments. Keep the
      // array in a local so Map.set receives exactly [sectionId, Block[]], even for empty sections.
      const blocks = await repos.blocks.listBySection(s.sectionId)
      blocksBySection.set(s.sectionId, blocks)
    }
    const records: SectionIndexRecord[] = []
    // Sections without text need no model call.
    for (const s of batch)
      if (!blocksBySection.get(s.sectionId)!.length)
        records.push({
          bookId,
          sectionId: s.sectionId,
          summary: s.title || 'Untitled section',
          defines: [],
          uses: [],
          flags: EMPTY_FLAGS,
          indexedWith: { model: 'none', promptVersion: '0' },
        })
    const withText = batch.filter(
      (s) => blocksBySection.get(s.sectionId)!.length,
    )
    let transient: LlmError | undefined
    if (withText.length) {
      const ctx = {
        prefix: await bookPrefix(),
        body: withText
          .map((s) => renderSection(s, blocksBySection.get(s.sectionId)!))
          .join('\n'),
      }
      const call = (escalate: boolean) =>
        llm.call('indexer', ctx, {
          signal,
          bookId,
          ...(escalate && { escalate }),
        })
      let res
      try {
        res = await call(false)
      } catch (e) {
        // Report the first completed call before escalation starts.
        if (e instanceof LlmError && !BLOCKING_CODES.has(e.code)) await report()
        if (!(e instanceof LlmError) || BLOCKING_CODES.has(e.code)) throw e
        try {
          res = await call(true)
        } catch (e2) {
          if (!(e2 instanceof LlmError) || BLOCKING_CODES.has(e2.code)) throw e2
          if (e2.code === 'schema')
            state.failedSectionIds.push(...withText.map((s) => s.sectionId))
          else if (TRANSIENT_CODES.has(e2.code)) {
            for (const s of withText) skippedThisRun.add(s.sectionId)
            if (TRANSIENT_CODES.has(e.code)) transient = e2
          }
        }
      }
      for (const out of res?.data.sections ?? []) {
        const blocks = blocksBySection.get(out.sectionId)
        if (!blocks || !withText.some((s) => s.sectionId === out.sectionId))
          continue
        const map = new Map(blocks.map((b) => [b.blockId, b]))
        // §6 phase B step 4: drop definitions whose quote does not ground.
        const defines = out.defines.flatMap((d) => {
          const g = ground(d.evidence, { blocks: map, label: d.name })
          return g.status === 'failed' || !g.evidence
            ? []
            : [{ name: d.name, evidence: g.evidence }]
        })
        records.push({
          ...out,
          defines,
          bookId,
          indexedWith: { model: res!.model, promptVersion: res!.promptVersion },
        })
      }
      for (const s of withText)
        if (res && !records.some((r) => r.sectionId === s.sectionId))
          state.failedSectionIds.push(s.sectionId)
    }
    const indexed = new Set(records.map((r) => r.sectionId))
    state.failedSectionIds = [...new Set(state.failedSectionIds)].filter(
      (id) => !indexed.has(id),
    )
    await repos.transaction(['sectionIndex', 'settings'], async () => {
      await repos.sectionIndex.bulkPut(records)
      await saveState()
    })
    for (const r of records) {
      settle(r.sectionId, true)
    }
    for (const s of batch) {
      const u = urgent.indexOf(s.sectionId)
      if (u >= 0) urgent.splice(u, 1)
    }
    for (const id of state.failedSectionIds) settle(id, false)
    for (const id of skippedThisRun) settle(id, false)
    await report()
    if (records.length > 0) transientBatchesInARow = 0
    else if (
      transient &&
      ++transientBatchesInARow >= MAX_TRANSIENT_BATCHES_IN_A_ROW
    )
      throw transient
    return records.length
  }

  async function bookPrefix(): Promise<string> {
    const book = await repos.books.get(bookId)
    return bookContext(book)
  }

  async function mergeGlossary(signal: AbortSignal): Promise<boolean> {
    const sections = await repos.sections.listByBook(bookId)
    const ordinals = new Map(sections.map((s) => [s.sectionId, s.ordinal]))
    const records = await repos.sectionIndex.listByBook(bookId)
    const existing = await repos.concepts.listByBook(bookId)
    const known: ConceptMerge[] = existing.map((c) => ({
      canonical: c.canonical,
      aliases: c.aliases,
    }))
    let clusters = clusterConcepts(records, ordinals, known)
    const groups = ambiguousGroups(clusters)
    if (groups.length) {
      const body = [
        '<clusters>',
        ...groups.map((g) =>
          [
            `  <group${attrs([['head', g[0]!.key.split(' ').at(-1)]])}>`,
            ...g.map(
              (c) =>
                `    <cluster>${[...c.names.keys()]
                  .sort()
                  .map((n) => `<name>${escapeText(n)}</name>`)
                  .join('')}</cluster>`,
            ),
            '  </group>',
          ].join('\n'),
        ),
        '</clusters>',
      ].join('\n')
      const res = await llm.call(
        'glossary',
        { prefix: await bookPrefix(), body },
        { signal, bookId },
      )
      clusters = clusterConcepts(records, ordinals, [
        ...known,
        ...res.data.merges,
      ])
    }
    const existingIds = new Map<string, string>()
    for (const c of existing)
      for (const n of [c.canonical, ...c.aliases])
        existingIds.set(nameKey(n), c.conceptId)
    const concepts = toConcepts(bookId, clusters, ordinals, existingIds)
    await repos.transaction(['concepts'], async () => {
      await repos.concepts.deleteByBook(bookId)
      await repos.concepts.bulkPut(concepts)
    })
    return groups.length > 0
  }

  async function summarize(signal: AbortSignal): Promise<boolean> {
    const sections = await repos.sections.listByBook(bookId)
    const byId = new Map(
      (await repos.sectionIndex.listByBook(bookId)).map((r) => [
        r.sectionId,
        r,
      ]),
    )
    const lines = (maxLevel: number) =>
      sections
        .filter((s) => s.level <= maxLevel && byId.has(s.sectionId))
        .map(
          (s) =>
            `  <summary${attrs([
              ['section', s.title],
              ['ordinal', s.ordinal],
            ])}>${escapeText(byId.get(s.sectionId)!.summary)}</summary>`,
        )
    let kept = lines(4)
    for (
      let level = 3;
      level >= 1 && estimateTokens(kept.join('\n')) > SUMMARY_BUDGET_TOKENS;
      level--
    )
      kept = lines(level)
    const body = ['<section_summaries>', ...kept, '</section_summaries>'].join(
      '\n',
    )
    const book = await repos.books.get(bookId)
    const res = await llm.call(
      'book-summary',
      { prefix: bookContext(book, false), body },
      { signal, bookId },
    )
    await repos.books.setSummary(bookId, res.data)
    return true
  }

  function start(retryGaps = false) {
    running ??= run(retryGaps)
    return running
  }

  return {
    start,
    async retryGaps() {
      while (running) await running
      return start(true)
    },
    pause() {
      controller?.abort()
    },
    setOpenSection(sectionId) {
      openSectionId = sectionId
    },
    async indexNow(sectionId, options) {
      if (await repos.sectionIndex.get(sectionId)) return true
      if (
        !options?.retryFailed &&
        (await readState()).failedSectionIds.includes(sectionId)
      )
        return false
      if (!urgent.includes(sectionId)) urgent.push(sectionId)
      const done = new Promise<boolean>((resolve) =>
        waiters.set(sectionId, [...(waiters.get(sectionId) ?? []), resolve]),
      )
      running ??= run()
      return done
    },
    progress: () => progress(),
  }
}

/** `<book_context>` for the indexer, glossary and summary calls: title, plus summary and conventions once known. */
export function bookContext(
  book: BookMeta | undefined,
  withSummary = true,
): string {
  const parts = [`<title>${escapeText(book?.title ?? '')}</title>`]
  if (withSummary && book?.summary) {
    parts.push(`<summary>${escapeText(book.summary.summary)}</summary>`)
    if (book.summary.conventions.length)
      parts.push(
        `<conventions>${book.summary.conventions
          .map((c) => `<convention>${escapeText(c)}</convention>`)
          .join('')}</conventions>`,
      )
  }
  return ['<book_context>', ...parts, '</book_context>'].join('\n')
}
