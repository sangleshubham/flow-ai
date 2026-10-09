// indexBookStructure: §6 Phase A end to end — load navigation and spine, walk each document in idle
// slices, build the structure, persist one transaction per spine item, mark the book `structural`.
import type { Book } from '@flow/epubjs'
import type { IllusRepos } from '@illus/core'

import { buildStructure, type SpineInput, type TocItem } from './build.ts'
import { INDEX_VERSION } from './text.ts'
import { walkDocument } from './walk.ts'

/** `requestIdleCallback`-shaped scheduler; tests inject one that runs at once. */
export type IdleScheduler = (run: (deadline: { timeRemaining(): number }) => void) => void

/** Longest idle slice (§6 step 3). */
export const SLICE_MS = 12

export type Progress =
  | { phase: 'walk'; spineDone: number; spineTotal: number }
  | { phase: 'persist'; spineDone: number; spineTotal: number }
  /** `skipped`: the stored index is already at `INDEX_VERSION`, nothing was read or written. */
  | { phase: 'done'; skipped: boolean; sectionCount: number }

export type IndexRepos = Pick<IllusRepos, 'books' | 'sections' | 'blocks' | 'crossRefs' | 'transaction'>

export interface IndexOptions {
  /** `makeBookId(epubBytes)` from `@illus/core`. */
  bookId: string
  scheduler?: IdleScheduler
  now?: () => number
}

const defaultScheduler: IdleScheduler = (run) => {
  const ric = (globalThis as { requestIdleCallback?: (cb: IdleRequestCallback) => number }).requestIdleCallback
  if (ric) ric(run)
  else setTimeout(() => run({ timeRemaining: () => SLICE_MS }), 0)
}

/** Runs a generator in idle slices of at most `SLICE_MS` (§6 step 3). */
export async function runInSlices<T>(gen: Generator<void, T>, schedule: IdleScheduler = defaultScheduler): Promise<T> {
  for (;;) {
    const deadline = await new Promise<{ timeRemaining(): number }>((resolve) => schedule(resolve))
    const start = performance.now()
    for (;;) {
      const step = gen.next()
      if (step.done) return step.value
      if (performance.now() - start >= SLICE_MS || deadline.timeRemaining() <= 0) break
    }
  }
}

/** epub.js `Section`, as it behaves at runtime (its .d.ts types `load` wrongly). */
interface SpineItem {
  index: number
  href: string
  cfiBase: string
  load(request: (path: string) => Promise<unknown>): Promise<Element>
}

/**
 * Structural pass of §6 Phase A. Does nothing when the book's stored `indexVersion` is already
 * `INDEX_VERSION` or newer; otherwise replaces the book's sections, blocks and cross-references.
 */
export async function* indexBookStructure(book: Book, repos: IndexRepos, opts: IndexOptions): AsyncGenerator<Progress> {
  const { bookId, scheduler, now = Date.now } = opts
  const existing = await repos.books.get(bookId)
  if (existing && existing.indexStatus !== 'none' && existing.indexVersion >= INDEX_VERSION) {
    yield { phase: 'done', skipped: true, sectionCount: existing.sectionCount ?? 0 }
    return
  }

  const [navigation, metadata] = await Promise.all([book.loaded.navigation, book.loaded.metadata])
  const items: SpineItem[] = []
  book.spine.each((item: SpineItem) => items.push(item))

  const spines: SpineInput[] = []
  for (const item of items) {
    const root = await item.load(book.load.bind(book))
    const { docTitle, sections } = await runInSlices(walkDocument(root.ownerDocument, item.cfiBase), scheduler)
    spines.push({ spineIndex: item.index, spineHref: item.href, docTitle, sections })
    yield { phase: 'walk', spineDone: spines.length, spineTotal: items.length }
  }

  const { sections, blocks, crossRefs } = await buildStructure(bookId, spines, navigation.toc as TocItem[])

  await repos.transaction(['sections', 'blocks', 'crossRefs'], async () => {
    await repos.sections.deleteByBook(bookId)
    await repos.blocks.deleteByBook(bookId)
    await repos.crossRefs.deleteByBook(bookId)
  })
  // §6 step 14: one transaction per spine item.
  for (const [i, { spineIndex }] of spines.entries()) {
    const own = sections.filter((s) => s.spineIndex === spineIndex)
    const ids = new Set(own.map((s) => s.sectionId))
    const ownBlocks = blocks.filter((b) => ids.has(b.sectionId))
    const blockIds = new Set(ownBlocks.map((b) => b.blockId))
    await repos.transaction(['sections', 'blocks', 'crossRefs'], async () => {
      await repos.sections.bulkPut(own)
      await repos.blocks.bulkPut(ownBlocks)
      await repos.crossRefs.bulkAdd(crossRefs.filter((r) => blockIds.has(r.fromBlockId)))
    })
    yield { phase: 'persist', spineDone: i + 1, spineTotal: spines.length }
  }

  const time = now()
  await repos.books.put({
    ...existing,
    bookId,
    title: existing?.title || metadata.title || '',
    indexStatus: 'structural',
    indexVersion: INDEX_VERSION,
    sectionCount: sections.length,
    createdAt: existing?.createdAt ?? time,
    updatedAt: time,
  })
  yield { phase: 'done', skipped: false, sectionCount: sections.length }
}
