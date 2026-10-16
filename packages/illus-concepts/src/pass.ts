// The concept pass (§6 phase B): background indexer batches, glossary merge, book summary. Resumable:
// progress is the set of stored SectionIndex records.
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

export type ConceptRepos = Pick<
  IllusRepos,
  'books' | 'sections' | 'blocks' | 'sectionIndex' | 'concepts' | 'transaction'
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
   * Sections whose batch failed twice in this run (ADR 0057). The pass still completes without them;
   * they stay unindexed until a later `start()` or `indexNow` retries them.
   */
  failed?: number
}

export interface ConceptPass {
  /** Runs until every section is indexed, `pause()` is called, or a plan limit stops it. Idempotent while running. */
  start(): Promise<ConceptPassProgress>
  /** Pauses after aborting the in-flight call (book closed, §6 phase B step 7). */
  pause(): void
  /** Re-prioritise around the open section (§6 phase B step 1). */
  setOpenSection(sectionId: string | null): void
  /** Jumps the queue; resolves `true` once the section is indexed, `false` if the pass stopped first. */
  indexNow(sectionId: string): Promise<boolean>
  progress(): Promise<ConceptPassProgress>
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
  /** Sections whose batch failed twice in this run; retried on the next `start()`. */
  const failed = new Set<string>()
  let sinceGlossary = 0

  async function progress(error?: LlmError): Promise<ConceptPassProgress> {
    const [total, indexed, book] = await Promise.all([
      repos.sections.listByBook(bookId).then((s) => s.length),
      repos.sectionIndex.countByBook(bookId),
      repos.books.get(bookId),
    ])
    return {
      indexed,
      total,
      done: book?.indexStatus === 'complete',
      ...(error && { error }),
      ...(failed.size > 0 && { failed: failed.size }),
    }
  }

  function settle(sectionId: string, ok: boolean) {
    for (const w of waiters.get(sectionId) ?? []) w(ok)
    waiters.delete(sectionId)
  }

  async function run(): Promise<ConceptPassProgress> {
    controller = new AbortController()
    const signal = controller.signal
    failed.clear()
    try {
      for (;;) {
        if (signal.aborted) return await progress()
        const sections = await repos.sections.listByBook(bookId)
        const indexed = new Set(
          (await repos.sectionIndex.listByBook(bookId)).map((r) => r.sectionId),
        )
        const pending = sections.filter(
          (s) => !indexed.has(s.sectionId) && !failed.has(s.sectionId),
        )
        if (!pending.length) {
          const book = await repos.books.get(bookId)
          // Only sections whose batch failed twice may remain: finish the book context anyway, so one
          // bad batch never keeps the whole book from completing (ADR 0057).
          if (book && book.indexStatus !== 'complete') {
            await mergeGlossary(signal)
            await summarize(signal)
            await repos.books.put({
              ...(await repos.books.get(bookId))!,
              indexStatus: 'complete',
              updatedAt: now(),
            })
          }
          return await progress()
        }
        const open = sections.find((s) => s.sectionId === openSectionId)
        const batch = takeBatch(prioritize(pending, open, urgent))
        const done = await indexBatch(batch, signal)
        sinceGlossary += done
        const p = await progress()
        deps.onProgress?.(p)
        if (sinceGlossary >= glossaryEvery) {
          await mergeGlossary(signal)
          sinceGlossary = 0
        }
        if (
          !(await repos.books.get(bookId))?.summary &&
          p.indexed / p.total >= SUMMARY_AT
        )
          await summarize(signal)
      }
    } catch (e) {
      if (e instanceof LlmError && e.code === 'aborted') return await progress()
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
        if (
          !(e instanceof LlmError) ||
          e.code === 'aborted' ||
          e.code === 'plan-limit' ||
          e.code === 'signin-required'
        )
          throw e
        try {
          res = await call(true)
        } catch (e2) {
          if (
            !(e2 instanceof LlmError) ||
            e2.code === 'aborted' ||
            e2.code === 'plan-limit' ||
            e2.code === 'signin-required'
          )
            throw e2
          withText.forEach((s) => failed.add(s.sectionId))
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
          failed.add(s.sectionId)
    }
    await repos.sectionIndex.bulkPut(records)
    for (const r of records) {
      settle(r.sectionId, true)
      const u = urgent.indexOf(r.sectionId)
      if (u >= 0) urgent.splice(u, 1)
    }
    for (const id of failed) settle(id, false)
    return records.length
  }

  async function bookPrefix(): Promise<string> {
    const book = await repos.books.get(bookId)
    return bookContext(book)
  }

  async function mergeGlossary(signal: AbortSignal): Promise<void> {
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
  }

  async function summarize(signal: AbortSignal): Promise<void> {
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
  }

  return {
    start() {
      running ??= run()
      return running
    },
    pause() {
      controller?.abort()
    },
    setOpenSection(sectionId) {
      openSectionId = sectionId
    },
    async indexNow(sectionId) {
      if (await repos.sectionIndex.get(sectionId)) return true
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
