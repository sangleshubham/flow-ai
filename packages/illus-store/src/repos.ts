// Dexie implementation of every `@illus/core` repository (§5). Records are validated with their schema on
// write, like the in-memory fakes in `@illus/core/testing`, so both behave the same in tests.
import { Dexie } from 'dexie'
import type { Table } from 'dexie'
import type { z } from 'zod'

import {
  BookMeta,
  Block,
  Concept,
  ConceptModel,
  CrossRef,
  LlmLogEntry,
  PlanRecord,
  SectionIndexRecord,
  SectionNode,
  TraceRecord,
  VisualRecord,
  parseBlockId,
} from '@illus/core'
import type { IllusRepos, KeyedRepo, StoreName } from '@illus/core'

import type { IllusDb } from './db.ts'

function keyed<T>(table: Table<unknown, unknown>, schema: z.ZodType<T>): KeyedRepo<T> {
  return {
    get: async (k) => (await table.get(k)) as T | undefined,
    bulkGet: async (ks) => (await table.bulkGet([...ks])) as (T | undefined)[],
    put: async (v) => void (await table.put(schema.parse(v))),
    bulkPut: async (vs) => void (await table.bulkPut(vs.map((v) => schema.parse(v)))),
    delete: async (k) => table.delete(k),
  }
}

const byOrdinal = <T extends { blockId: string }>(rows: T[]) =>
  rows.sort((a, b) => (parseBlockId(a.blockId)?.n ?? 0) - (parseBlockId(b.blockId)?.n ?? 0))
const prefix = (bookId: string) => `${bookId}:`
const section = (bookId: string, sectionId: string) => [bookId, sectionId]

export function createDexieRepos(db: IllusDb): IllusRepos {
  const t = db as unknown as Record<StoreName, Table<never, unknown>>
  const all = <T>(c: { toArray(): Promise<unknown[]> }) => c.toArray() as Promise<T[]>
  const delWhere = (store: StoreName, index: string) => async (bookId: string) => void (await t[store].where(index).equals(bookId).delete())

  return {
    books: {
      ...keyed(t.books, BookMeta),
      listByIndexStatus: (status) => all(t.books.where('indexStatus').equals(status)),
      async setSummary(bookId, summary) {
        const n = await t.books.update(bookId, { summary } as never)
        if (!n) throw new Error(`no book ${bookId}`)
      },
    },
    sections: {
      ...keyed(t.sections, SectionNode),
      listByBook: (bookId) => all(t.sections.where('[bookId+ordinal]').between([bookId, Dexie.minKey], [bookId, Dexie.maxKey])),
      getByOrdinal: async (bookId, ordinal) => (await t.sections.where('[bookId+ordinal]').equals([bookId, ordinal]).first()) as SectionNode | undefined,
      deleteByBook: delWhere('sections', 'bookId'),
    },
    blocks: {
      ...keyed(t.blocks, Block),
      listBySection: async (sectionId) => byOrdinal(await all<Block>(t.blocks.where('sectionId').equals(sectionId))),
      deleteByBook: async (bookId) => void (await t.blocks.where('blockId').startsWith(prefix(bookId)).delete()),
    },
    crossRefs: {
      async bulkAdd(refs) {
        const rows = refs.map((r) => {
          const { id: _id, ...rest } = CrossRef.parse(r)
          return rest
        })
        return (await t.crossRefs.bulkAdd(rows as never[], { allKeys: true })) as number[]
      },
      listFromBlock: (fromBlockId) => all(t.crossRefs.where('fromBlockId').equals(fromBlockId)),
      listToSection: (sectionId) => all(t.crossRefs.where('targetSectionId').equals(sectionId)),
      deleteByBook: async (bookId) => void (await t.crossRefs.where('fromBlockId').startsWith(prefix(bookId)).delete()),
    },
    sectionIndex: {
      ...keyed(t.sectionIndex, SectionIndexRecord),
      listByBook: (bookId) => all(t.sectionIndex.where('bookId').equals(bookId)),
      countByBook: (bookId) => t.sectionIndex.where('bookId').equals(bookId).count(),
      deleteByBook: delWhere('sectionIndex', 'bookId'),
    },
    concepts: {
      ...keyed(t.concepts, Concept),
      listByBook: (bookId) => all(t.concepts.where('bookId').equals(bookId)),
      async findByName(bookId, name) {
        const [byAlias, byCanonical] = await Promise.all([
          all<Concept>(t.concepts.where('aliases').equals(name)),
          all<Concept>(t.concepts.where('canonical').equals(name)),
        ])
        const seen = new Map([...byAlias, ...byCanonical].filter((c) => c.bookId === bookId).map((c) => [c.conceptId, c]))
        return [...seen.values()]
      },
      deleteByBook: delWhere('concepts', 'bookId'),
    },
    conceptModels: {
      ...keyed(t.conceptModels, ConceptModel),
      listByBook: (bookId) => all(t.conceptModels.where('bookId').equals(bookId)),
      listByConcept: (conceptId) => all(t.conceptModels.where('conceptId').equals(conceptId)),
      deleteByBook: delWhere('conceptModels', 'bookId'),
    },
    plans: {
      ...keyed(t.plans, PlanRecord),
      listBySection: (bookId, sectionId) => all(t.plans.where('[bookId+sectionId]').equals(section(bookId, sectionId))),
      deleteByBook: delWhere('plans', 'bookId'),
    },
    visuals: {
      ...keyed(t.visuals, VisualRecord),
      listBySection: (bookId, sectionId) => all(t.visuals.where('[bookId+sectionId]').equals(section(bookId, sectionId))),
      listByPlanItem: (planItemId) => all(t.visuals.where('planItemId').equals(planItemId)),
      deleteByBook: delWhere('visuals', 'bookId'),
    },
    traces: {
      ...keyed(t.traces, TraceRecord),
      listByCodeBlock: (codeBlockId) => all(t.traces.where('codeBlockId').equals(codeBlockId)),
      deleteByBook: delWhere('traces', 'bookId'),
    },
    llmLog: {
      async add(entry) {
        const { id: _id, ...row } = LlmLogEntry.parse(entry)
        return (await t.llmLog.add(row as never)) as number
      },
      async list(filter = {}) {
        let c = t.llmLog.orderBy('createdAt').reverse()
        if (filter.since !== undefined) c = t.llmLog.where('createdAt').aboveOrEqual(filter.since).reverse()
        const rows = (await c.toArray()) as unknown as LlmLogEntry[]
        return rows
          .filter((e) => !filter.role || e.role === filter.role)
          .sort((a, b) => b.createdAt - a.createdAt || (b.id ?? 0) - (a.id ?? 0))
          .slice(0, filter.limit ?? Infinity)
      },
    },
    settings: {
      get: async <T>(key: string) => ((await t.settings.get(key)) as { value: T } | undefined)?.value,
      set: async (key, value) => void (await t.settings.put({ key, value } as never)),
      delete: (key) => t.settings.delete(key),
      list: () => all(t.settings.toCollection()),
    },
    transaction: (stores, fn) => db.transaction('rw', [...stores], fn),
  }
}
