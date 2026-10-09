import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import type { IllusRepos } from '@illus/core'
import { SECTION_COMMIT_ID, SECTION_LEADERS_ID, SMALL_BOOK_ID, buildSmallBook, createMemoryRepos, make, sb } from '@illus/core/testing'

import {
  DB_VERSION,
  collectCache,
  createDexieRepos,
  enforceStorageBudget,
  exportCache,
  importCache,
  openIllusDb,
  requestPersistence,
} from '../src/index.ts'

const OTHER_BOOK = 'fedcba9876543210'

function freshDb(version?: number, factory = new IDBFactory()) {
  return { db: openIllusDb({ indexedDB: factory, IDBKeyRange, ...(version && { version }) }), factory }
}

async function seed(repos: IllusRepos) {
  const book = await buildSmallBook()
  await repos.books.put(book.book)
  await repos.sections.bulkPut(book.sections)
  await repos.blocks.bulkPut(book.blocks)
  await repos.crossRefs.bulkAdd(book.crossRefs)
  await repos.sectionIndex.bulkPut(book.sectionIndex)
  await repos.concepts.bulkPut(book.concepts)
  await repos.conceptModels.put(make.conceptModel())
  await repos.plans.put(make.planRecord())
  await repos.visuals.put(make.visualRecord())
  await repos.traces.put(make.traceRecord())
  return book
}

// The Dexie repos must behave exactly like the @illus/core/testing fakes other workstreams develop against.
describe.each([
  ['dexie', () => createDexieRepos(freshDb().db)],
  ['memory fake', () => createMemoryRepos()],
])('repositories (%s)', (_name, create) => {
  it('stores and queries every store by its indexes', async () => {
    const repos = create()
    const book = await seed(repos)
    expect(await repos.books.listByIndexStatus(book.book.indexStatus)).toHaveLength(1)
    await repos.books.setSummary(SMALL_BOOK_ID, make.bookSummary())
    expect((await repos.books.get(SMALL_BOOK_ID))!.summary).toEqual(make.bookSummary())
    await expect(repos.books.setSummary(OTHER_BOOK, make.bookSummary())).rejects.toThrow()

    const sections = await repos.sections.listByBook(SMALL_BOOK_ID)
    expect(sections.map((s) => s.ordinal)).toEqual([...book.sections].map((s) => s.ordinal).sort((a, b) => a - b))
    expect((await repos.sections.getByOrdinal(SMALL_BOOK_ID, 1))!.sectionId).toBe(SECTION_LEADERS_ID)

    const blocks = await repos.blocks.listBySection(SECTION_LEADERS_ID)
    expect(blocks.map((b) => b.blockId)).toEqual([0, 1, 2, 3, 4].map((n) => sb(SECTION_LEADERS_ID, n)))
    expect(await repos.blocks.bulkGet([sb(SECTION_LEADERS_ID, 0), 'missing'])).toEqual([blocks[0], undefined])

    const refs = book.crossRefs
    if (refs.length) {
      expect(await repos.crossRefs.listFromBlock(refs[0]!.fromBlockId)).toEqual([expect.objectContaining({ ...refs[0], id: expect.any(Number) })])
    }
    expect(await repos.sectionIndex.countByBook(SMALL_BOOK_ID)).toBe(book.sectionIndex.length)

    const concept = book.concepts[0]!
    expect((await repos.concepts.findByName(SMALL_BOOK_ID, concept.canonical)).map((c) => c.conceptId)).toEqual([concept.conceptId])
    if (concept.aliases[0]) expect(await repos.concepts.findByName(SMALL_BOOK_ID, concept.aliases[0])).toHaveLength(1)
    expect(await repos.concepts.findByName(OTHER_BOOK, concept.canonical)).toEqual([])

    expect(await repos.conceptModels.listByConcept(make.conceptModel().conceptId)).toHaveLength(1)
    expect(await repos.plans.listBySection(SMALL_BOOK_ID, SECTION_LEADERS_ID)).toEqual([make.planRecord()])
    expect(await repos.visuals.listByPlanItem('p1')).toEqual([make.visualRecord()])
    expect(await repos.traces.listByCodeBlock(sb(SECTION_COMMIT_ID, 1))).toEqual([make.traceRecord()])
  })

  it('validates on write', async () => {
    const repos = create()
    await expect(repos.visuals.put({ ...make.visualRecord(), usageTokens: -1 })).rejects.toThrow()
    await expect(repos.books.put({ ...make.bookMeta(), bookId: 'NOT-HEX' })).rejects.toThrow()
  })

  it('deleteByBook removes one book and keeps others', async () => {
    const repos = create()
    await seed(repos)
    await repos.plans.put(make.planRecord({ cacheKey: 'c'.repeat(64), bookId: OTHER_BOOK, sectionId: `${OTHER_BOOK}:0:x:0` }))
    for (const store of ['sections', 'blocks', 'crossRefs', 'sectionIndex', 'concepts', 'conceptModels', 'plans', 'visuals', 'traces'] as const)
      await repos[store].deleteByBook(SMALL_BOOK_ID)
    expect(await repos.sections.listByBook(SMALL_BOOK_ID)).toEqual([])
    expect(await repos.blocks.listBySection(SECTION_LEADERS_ID)).toEqual([])
    expect(await repos.traces.get(make.traceRecord().cacheKey)).toBeUndefined()
    expect(await repos.plans.get('c'.repeat(64))).toBeDefined()
  })

  it('llmLog lists newest first with filters; settings round-trip', async () => {
    const repos = create()
    const a = await repos.llmLog.add(make.llmLogEntry({ createdAt: 1 }))
    const b = await repos.llmLog.add(make.llmLogEntry({ createdAt: 3, role: 'critic' }))
    await repos.llmLog.add(make.llmLogEntry({ createdAt: 2 }))
    expect(b).toBeGreaterThan(a)
    expect((await repos.llmLog.list()).map((e) => e.createdAt)).toEqual([3, 2, 1])
    expect((await repos.llmLog.list({ role: 'planner', since: 2 })).map((e) => e.createdAt)).toEqual([2])
    expect(await repos.llmLog.list({ limit: 1 })).toHaveLength(1)
    await repos.settings.set('flags', { templates: true })
    expect(await repos.settings.get('flags')).toEqual({ templates: true })
    expect(await repos.settings.list()).toEqual([{ key: 'flags', value: { templates: true } }])
    await repos.settings.delete('flags')
    expect(await repos.settings.get('flags')).toBeUndefined()
  })
})

describe('migrations', () => {
  it('opens at the latest version', async () => {
    const { db } = freshDb()
    await db.open()
    expect(db.verno).toBe(DB_VERSION)
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      ['blocks', 'books', 'concepts', 'conceptModels', 'crossRefs', 'llmLog', 'plans', 'sectionIndex', 'sections', 'settings', 'traces', 'visuals'].sort(),
    )
  })

  it('v1 → v2 keeps data and adds the bookId/createdAt indexes', async () => {
    const factory = new IDBFactory()
    const v1 = freshDb(1, factory).db
    const r1 = createDexieRepos(v1)
    await r1.visuals.put(make.visualRecord())
    await r1.traces.put(make.traceRecord())
    await r1.settings.set('debugPrompts', true)
    expect(v1.verno).toBe(1)
    v1.close()

    const v2 = openIllusDb({ indexedDB: factory, IDBKeyRange })
    const r2 = createDexieRepos(v2)
    expect(await r2.visuals.get(make.visualRecord().cacheKey)).toEqual(make.visualRecord())
    expect(await r2.settings.get('debugPrompts')).toBe(true)
    // New indexes work on migrated rows.
    await r2.traces.deleteByBook(SMALL_BOOK_ID)
    expect(await r2.traces.listByCodeBlock(make.traceRecord().codeBlockId)).toEqual([])
    expect(await v2.visuals.where('createdAt').below(Infinity).count()).toBe(1)
    expect(v2.verno).toBe(2)
  })
})

describe('exportCache / importCache', () => {
  it('round-trips a book’s cache into an empty database', async () => {
    const source = createDexieRepos(freshDb().db)
    await seed(source)
    await source.llmLog.add(make.llmLogEntry())
    const blob = await exportCache(source, SMALL_BOOK_ID, () => 42)
    expect(blob.type).toBe('application/json')
    const exported = await collectCache(source, SMALL_BOOK_ID, () => 42)
    expect(exported.stores.visuals).toHaveLength(1)
    expect(exported.stores.traces).toHaveLength(1)

    const target = createDexieRepos(freshDb().db)
    const summary = await importCache(target, blob)
    expect(summary.counts).toMatchObject({ books: 1, plans: 1, visuals: 1, traces: 1, conceptModels: 1 })
    expect(await collectCache(target, SMALL_BOOK_ID, () => 42)).toEqual(exported)
    expect(await target.llmLog.list()).toEqual([]) // logs are not part of the cache file
  })

  it('import replaces the book’s old records and works across implementations', async () => {
    const source = createMemoryRepos()
    await seed(source)
    const file = await collectCache(source, SMALL_BOOK_ID)
    const target = createDexieRepos(freshDb().db)
    await target.visuals.put(make.visualRecord({ cacheKey: 'd'.repeat(64), planItemId: 'old' }))
    await importCache(target, JSON.stringify(file))
    expect(await target.visuals.listByPlanItem('old')).toEqual([])
    expect(await target.visuals.listByPlanItem('p1')).toHaveLength(1)
  })

  it('rejects invalid files and records of another book without writing anything', async () => {
    const repos = createDexieRepos(freshDb().db)
    await expect(importCache(repos, 'nope')).rejects.toThrow(/not a JSON/)
    await expect(importCache(repos, { format: 'other' })).rejects.toThrow(/invalid cache file/)
    const source = createMemoryRepos()
    await seed(source)
    const file = await collectCache(source, SMALL_BOOK_ID)
    file.stores.plans.push(make.planRecord({ cacheKey: 'e'.repeat(64), bookId: OTHER_BOOK }))
    await expect(importCache(repos, file)).rejects.toThrow(/another book/)
    expect(await repos.books.get(SMALL_BOOK_ID)).toBeUndefined()
  })
})

describe('storage lifecycle (§15)', () => {
  it('requests persistent storage once', async () => {
    const repos = createMemoryRepos()
    let calls = 0
    const storage = { persist: async () => (calls++, true) }
    expect(await requestPersistence(repos.settings, storage)).toBe(true)
    expect(await requestPersistence(repos.settings, storage)).toBe(true)
    expect(calls).toBe(1)
    expect(await requestPersistence(createMemoryRepos().settings, undefined)).toBeUndefined()
  })

  it('evicts oldest stale records first, then oldest non-pinned, never pinned, until under budget', async () => {
    const { db } = freshDb()
    const repos = createDexieRepos(db)
    const key = (c: string) => c.repeat(64)
    await repos.visuals.bulkPut([
      make.visualRecord({ cacheKey: key('1'), createdAt: 1, stale: false }),
      make.visualRecord({ cacheKey: key('2'), createdAt: 2, stale: true }),
      make.visualRecord({ cacheKey: key('3'), createdAt: 0, stale: false, pinned: true }),
      make.visualRecord({ cacheKey: key('4'), createdAt: 4, stale: false }),
    ])
    await repos.plans.put(make.planRecord({ cacheKey: key('5'), createdAt: 3, stale: true }))
    await repos.traces.put(make.traceRecord({ cacheKey: key('6'), createdAt: 5, stale: false }))
    // Fake estimate: 100 bytes per cache row; budget allows 3 rows.
    const storage = { estimate: async () => ({ usage: 100 * ((await db.visuals.count()) + (await db.plans.count()) + (await db.traces.count())) }) }
    const res = await enforceStorageBudget(db, { storage, budgetBytes: 300, batchSize: 1 })
    expect(res).toEqual({ evicted: 3, usageBefore: 600, usageAfter: 300 })
    // Stale first (2, 5), then the oldest non-pinned (1); pinned (3) survives although it is the oldest.
    expect((await db.visuals.toCollection().primaryKeys()).sort()).toEqual([key('3'), key('4')])
    expect(await db.plans.count()).toBe(0)
    expect(await db.traces.count()).toBe(1)
  })

  it('does nothing under budget or without an estimate', async () => {
    const { db } = freshDb()
    expect(await enforceStorageBudget(db, { storage: { estimate: async () => ({ usage: 10 }) } })).toMatchObject({ evicted: 0 })
    expect(await enforceStorageBudget(db, { storage: undefined })).toMatchObject({ evicted: 0, usageBefore: undefined })
  })
})
