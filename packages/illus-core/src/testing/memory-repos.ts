// In-memory fakes of every repository in `@illus/core` repos. Records are validated with their schema on
// write and cloned on read and write, mimicking IndexedDB's structured clone.
import type { z } from 'zod'

import { parseBlockId } from '../ids/index.ts'
import type { IllusRepos, KeyedRepo } from '../repos/index.ts'
import { BookMeta, Block, CrossRef, SectionNode } from '../schemas/book.ts'
import { Concept, SectionIndexRecord } from '../schemas/concepts.ts'
import { ConceptModel } from '../schemas/concept-model.ts'
import { PlanRecord } from '../schemas/plan.ts'
import { LlmLogEntry, VisualRecord } from '../schemas/records.ts'
import { TraceRecord } from '../schemas/trace.ts'

interface Table<T> extends KeyedRepo<T> {
  all(): T[]
  deleteWhere(pred: (t: T) => boolean): void
}

function table<T>(schema: z.ZodType<T>, keyOf: (t: T) => string): Table<T> {
  const rows = new Map<string, T>()
  const write = (v: T) => {
    const parsed = structuredClone(schema.parse(v))
    rows.set(keyOf(parsed), parsed)
  }
  const read = (k: string) => {
    const v = rows.get(k)
    return v === undefined ? undefined : structuredClone(v)
  }
  return {
    get: async (k) => read(k),
    bulkGet: async (ks) => ks.map(read),
    put: async (v) => write(v),
    bulkPut: async (vs) => vs.forEach(write),
    delete: async (k) => void rows.delete(k),
    all: () => [...rows.values()].map((v) => structuredClone(v)),
    deleteWhere: (pred) => {
      for (const [k, v] of rows) if (pred(v)) rows.delete(k)
    },
  }
}

const inBook = (bookId: string) => (id: string) => id.startsWith(`${bookId}:`)

/** A fresh, empty set of in-memory repositories. `transaction` just runs `fn` (no rollback). */
export function createMemoryRepos(): IllusRepos {
  const books = table(BookMeta, (b) => b.bookId)
  const sections = table(SectionNode, (s) => s.sectionId)
  const blocks = table(Block, (b) => b.blockId)
  const sectionIndex = table(SectionIndexRecord, (s) => s.sectionId)
  const concepts = table(Concept, (c) => c.conceptId)
  const conceptModels = table(ConceptModel, (m) => m.conceptModelId)
  const plans = table(PlanRecord, (p) => p.cacheKey)
  const visuals = table(VisualRecord, (v) => v.cacheKey)
  const traces = table(TraceRecord, (t) => t.cacheKey)
  const crossRefs: CrossRef[] = []
  const llmLog: LlmLogEntry[] = []
  const settings = new Map<string, unknown>()
  let crossRefSeq = 0
  let llmLogSeq = 0

  return {
    books: {
      ...books,
      listByIndexStatus: async (status) => books.all().filter((b) => b.indexStatus === status),
      setSummary: async (bookId, summary) => {
        const book = await books.get(bookId)
        if (!book) throw new Error(`no book ${bookId}`)
        await books.put({ ...book, summary })
      },
    },
    sections: {
      ...sections,
      listByBook: async (bookId) => sections.all().filter((s) => s.bookId === bookId).sort((a, b) => a.ordinal - b.ordinal),
      getByOrdinal: async (bookId, ordinal) => sections.all().find((s) => s.bookId === bookId && s.ordinal === ordinal),
      deleteByBook: async (bookId) => sections.deleteWhere((s) => s.bookId === bookId),
    },
    blocks: {
      ...blocks,
      listBySection: async (sectionId) =>
        blocks
          .all()
          .filter((b) => b.sectionId === sectionId)
          .sort((a, b) => (parseBlockId(a.blockId)?.n ?? 0) - (parseBlockId(b.blockId)?.n ?? 0)),
      deleteByBook: async (bookId) => blocks.deleteWhere((b) => inBook(bookId)(b.blockId)),
    },
    crossRefs: {
      bulkAdd: async (refs) =>
        refs.map((r) => {
          const id = ++crossRefSeq
          crossRefs.push(structuredClone(CrossRef.parse({ ...r, id })))
          return id
        }),
      listFromBlock: async (fromBlockId) => structuredClone(crossRefs.filter((r) => r.fromBlockId === fromBlockId)),
      listToSection: async (sectionId) => structuredClone(crossRefs.filter((r) => r.targetSectionId === sectionId)),
      deleteByBook: async (bookId) => {
        const keep = crossRefs.filter((r) => !inBook(bookId)(r.fromBlockId))
        crossRefs.splice(0, crossRefs.length, ...keep)
      },
    },
    sectionIndex: {
      ...sectionIndex,
      listByBook: async (bookId) => sectionIndex.all().filter((s) => s.bookId === bookId),
      countByBook: async (bookId) => sectionIndex.all().filter((s) => s.bookId === bookId).length,
      deleteByBook: async (bookId) => sectionIndex.deleteWhere((s) => s.bookId === bookId),
    },
    concepts: {
      ...concepts,
      listByBook: async (bookId) => concepts.all().filter((c) => c.bookId === bookId),
      findByName: async (bookId, name) =>
        concepts.all().filter((c) => c.bookId === bookId && (c.canonical === name || c.aliases.includes(name))),
      deleteByBook: async (bookId) => concepts.deleteWhere((c) => c.bookId === bookId),
    },
    conceptModels: {
      ...conceptModels,
      listByBook: async (bookId) => conceptModels.all().filter((m) => m.bookId === bookId),
      listByConcept: async (conceptId) => conceptModels.all().filter((m) => m.conceptId === conceptId),
      deleteByBook: async (bookId) => conceptModels.deleteWhere((m) => m.bookId === bookId),
    },
    plans: {
      ...plans,
      listBySection: async (bookId, sectionId) =>
        plans.all().filter((p) => p.bookId === bookId && p.sectionId === sectionId),
      deleteByBook: async (bookId) => plans.deleteWhere((p) => p.bookId === bookId),
    },
    visuals: {
      ...visuals,
      listBySection: async (bookId, sectionId) =>
        visuals.all().filter((v) => v.bookId === bookId && v.sectionId === sectionId),
      listByPlanItem: async (planItemId) => visuals.all().filter((v) => v.planItemId === planItemId),
      deleteByBook: async (bookId) => visuals.deleteWhere((v) => v.bookId === bookId),
    },
    traces: {
      ...traces,
      listByCodeBlock: async (codeBlockId) => traces.all().filter((t) => t.codeBlockId === codeBlockId),
      deleteByBook: async (bookId) => traces.deleteWhere((t) => t.bookId === bookId),
    },
    llmLog: {
      add: async (entry) => {
        const id = ++llmLogSeq
        llmLog.push(structuredClone(LlmLogEntry.parse({ ...entry, id })))
        return id
      },
      list: async (filter = {}) =>
        structuredClone(
          llmLog
            .filter((e) => (!filter.role || e.role === filter.role) && (!filter.since || e.createdAt >= filter.since))
            .sort((a, b) => b.createdAt - a.createdAt || (b.id ?? 0) - (a.id ?? 0))
            .slice(0, filter.limit ?? Infinity),
        ),
    },
    settings: {
      get: async <T>(key: string) => structuredClone(settings.get(key)) as T | undefined,
      set: async (key, value) => void settings.set(key, structuredClone(value)),
      delete: async (key) => void settings.delete(key),
      list: async () => [...settings].map(([key, value]) => ({ key, value: structuredClone(value) })),
    },
    transaction: async (_stores, fn) => fn(),
  }
}
