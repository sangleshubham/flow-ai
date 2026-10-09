// Export and import of one book's cache as a single JSON file (§2 D10, §15 "Cache lifecycle"): the book
// row, its index (sections, blocks, cross-refs, section index, concepts), concept models, plans, visuals
// and traces. Works over any `IllusRepos` (Dexie or the in-memory fakes). `llmLog` and settings stay local.
import { z } from 'zod'

import {
  BookMeta,
  Block,
  CONTRACTS_VERSION,
  Concept,
  ConceptModel,
  CrossRef,
  PlanRecord,
  SectionIndexRecord,
  SectionNode,
  TraceRecord,
  VisualRecord,
} from '@illus/core'
import type { IllusRepos } from '@illus/core'

export const CACHE_FILE_FORMAT = 'illus-cache'
export const CACHE_FILE_VERSION = 1

const BOOK_STORES = ['books', 'sections', 'blocks', 'crossRefs', 'sectionIndex', 'concepts', 'conceptModels', 'plans', 'visuals', 'traces'] as const

export const CacheFile = z.object({
  format: z.literal(CACHE_FILE_FORMAT),
  version: z.literal(CACHE_FILE_VERSION),
  contractsVersion: z.string(),
  bookId: z.string().regex(/^[0-9a-f]{16}$/),
  exportedAt: z.number().int().nonnegative(),
  stores: z.object({
    books: z.array(BookMeta).max(1),
    sections: z.array(SectionNode),
    blocks: z.array(Block),
    crossRefs: z.array(CrossRef),
    sectionIndex: z.array(SectionIndexRecord),
    concepts: z.array(Concept),
    conceptModels: z.array(ConceptModel),
    plans: z.array(PlanRecord),
    visuals: z.array(VisualRecord),
    traces: z.array(TraceRecord),
  }),
})
export type CacheFile = z.infer<typeof CacheFile>

/** Everything cached for `bookId`, as a JSON `Blob` (`application/json`) ready to download. */
export async function exportCache(repos: IllusRepos, bookId: string, now: () => number = Date.now): Promise<Blob> {
  return new Blob([JSON.stringify(await collectCache(repos, bookId, now))], { type: 'application/json' })
}

/** The cache file object behind `exportCache`. */
export async function collectCache(repos: IllusRepos, bookId: string, now: () => number = Date.now): Promise<CacheFile> {
  const book = await repos.books.get(bookId)
  const sections = await repos.sections.listByBook(bookId)
  const blocks = (await Promise.all(sections.map((s) => repos.blocks.listBySection(s.sectionId)))).flat()
  const perSection = <T>(fn: (sectionId: string) => Promise<T[]>) => Promise.all(sections.map((s) => fn(s.sectionId))).then((r) => r.flat())
  const crossRefs = (await Promise.all(blocks.map((b) => repos.crossRefs.listFromBlock(b.blockId)))).flat().map(({ id: _id, ...r }) => r)
  const traces = (await Promise.all(blocks.filter((b) => b.kind === 'code').map((b) => repos.traces.listByCodeBlock(b.blockId))))
    .flat()
    .filter((t) => t.bookId === bookId)
  return {
    format: CACHE_FILE_FORMAT,
    version: CACHE_FILE_VERSION,
    contractsVersion: CONTRACTS_VERSION,
    bookId,
    exportedAt: now(),
    stores: {
      books: book ? [book] : [],
      sections,
      blocks,
      crossRefs,
      sectionIndex: await repos.sectionIndex.listByBook(bookId),
      concepts: await repos.concepts.listByBook(bookId),
      conceptModels: await repos.conceptModels.listByBook(bookId),
      plans: await perSection((id) => repos.plans.listBySection(bookId, id)),
      visuals: await perSection((id) => repos.visuals.listBySection(bookId, id)),
      traces,
    },
  }
}

export interface ImportSummary {
  bookId: string
  counts: Record<(typeof BOOK_STORES)[number], number>
}

/**
 * Validates a cache file and replaces that book's records with it, atomically. Every record must belong
 * to the file's book; anything invalid rejects the whole import before a single write.
 */
export async function importCache(repos: IllusRepos, file: Blob | string | unknown): Promise<ImportSummary> {
  const raw = typeof file === 'string' ? file : file instanceof Blob ? await file.text() : undefined
  let json: unknown = file
  if (raw !== undefined) {
    try {
      json = JSON.parse(raw)
    } catch {
      throw new Error('not a JSON cache file')
    }
  }
  const parsed = CacheFile.safeParse(json)
  if (!parsed.success) throw new Error(`invalid cache file: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  const { bookId, stores: s } = parsed.data
  const own = (id: string) => id.startsWith(`${bookId}:`)
  const foreign = [
    ...s.books.filter((b) => b.bookId !== bookId),
    ...[s.sections, s.sectionIndex, s.concepts, s.conceptModels, s.plans, s.visuals, s.traces].flatMap((rows) =>
      (rows as { bookId: string }[]).filter((r) => r.bookId !== bookId),
    ),
    ...s.blocks.filter((b) => !own(b.blockId)),
    ...s.crossRefs.filter((r) => !own(r.fromBlockId)),
  ]
  if (foreign.length) throw new Error(`cache file for ${bookId} contains ${foreign.length} records of another book`)

  await repos.transaction([...BOOK_STORES], async () => {
    await Promise.all(BOOK_STORES.filter((n) => n !== 'books').map((n) => repos[n].deleteByBook(bookId)))
    if (s.books[0]) await repos.books.put(s.books[0])
    await repos.sections.bulkPut(s.sections)
    await repos.blocks.bulkPut(s.blocks)
    await repos.crossRefs.bulkAdd(s.crossRefs.map(({ id: _id, ...r }) => r))
    await repos.sectionIndex.bulkPut(s.sectionIndex)
    await repos.concepts.bulkPut(s.concepts)
    await repos.conceptModels.bulkPut(s.conceptModels)
    await repos.plans.bulkPut(s.plans)
    await repos.visuals.bulkPut(s.visuals)
    await repos.traces.bulkPut(s.traces)
  })
  return { bookId, counts: Object.fromEntries(BOOK_STORES.map((n) => [n, s[n].length])) as ImportSummary['counts'] }
}
