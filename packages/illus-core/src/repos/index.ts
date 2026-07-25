// Repository interfaces for every IndexedDB store of §5 (database `illus`). W2 implements them with
// Dexie in @illus/store; `@illus/core/testing` has in-memory fakes. W1/W3 persist only through these.
import type { BookMeta, CrossRef, IndexStatus, SectionNode, Block, BookSummary } from '../schemas/book.ts'
import type { Concept, SectionIndexRecord } from '../schemas/concepts.ts'
import type { ConceptModel } from '../schemas/concept-model.ts'
import type { RoleName } from '../schemas/llm.ts'
import type { PlanRecord } from '../schemas/plan.ts'
import type { LlmLogEntry, SettingRecord, VisualRecord } from '../schemas/records.ts'
import type { TraceRecord } from '../schemas/trace.ts'

/** Names of the stores in the `illus` database. */
export const STORE_NAMES = [
  'books',
  'sections',
  'blocks',
  'crossRefs',
  'sectionIndex',
  'concepts',
  'conceptModels',
  'plans',
  'visuals',
  'traces',
  'llmLog',
  'settings',
] as const
export type StoreName = (typeof STORE_NAMES)[number]

/** Basic keyed access shared by every store. `put` upserts. */
export interface KeyedRepo<T, K = string> {
  get(key: K): Promise<T | undefined>
  bulkGet(keys: readonly K[]): Promise<(T | undefined)[]>
  put(value: T): Promise<void>
  bulkPut(values: readonly T[]): Promise<void>
  delete(key: K): Promise<void>
}

/** Stores whose records carry `bookId` can drop a whole book (re-index, clear visuals, §14 settings). */
export interface PerBook {
  deleteByBook(bookId: string): Promise<void>
}

export interface BooksRepo extends KeyedRepo<BookMeta> {
  listByIndexStatus(status: IndexStatus): Promise<BookMeta[]>
  setSummary(bookId: string, summary: BookSummary): Promise<void>
}

export interface SectionsRepo extends KeyedRepo<SectionNode>, PerBook {
  /** All sections of a book in reading order (`[bookId+ordinal]`). */
  listByBook(bookId: string): Promise<SectionNode[]>
  getByOrdinal(bookId: string, ordinal: number): Promise<SectionNode | undefined>
}

export interface BlocksRepo extends KeyedRepo<Block>, PerBook {
  /** Blocks of a section in block order. */
  listBySection(sectionId: string): Promise<Block[]>
}

export interface CrossRefsRepo extends PerBook {
  /** Adds refs and returns their auto-increment ids. */
  bulkAdd(refs: readonly CrossRef[]): Promise<number[]>
  listFromBlock(fromBlockId: string): Promise<CrossRef[]>
  listToSection(targetSectionId: string): Promise<CrossRef[]>
}

export interface SectionIndexRepo extends KeyedRepo<SectionIndexRecord>, PerBook {
  listByBook(bookId: string): Promise<SectionIndexRecord[]>
  countByBook(bookId: string): Promise<number>
}

export interface ConceptsRepo extends KeyedRepo<Concept>, PerBook {
  listByBook(bookId: string): Promise<Concept[]>
  /** Case-sensitive match on the `*aliases` multi-entry index or `canonical`. */
  findByName(bookId: string, name: string): Promise<Concept[]>
}

export interface ConceptModelsRepo extends KeyedRepo<ConceptModel>, PerBook {
  listByBook(bookId: string): Promise<ConceptModel[]>
  listByConcept(conceptId: string): Promise<ConceptModel[]>
}

export interface PlansRepo extends KeyedRepo<PlanRecord>, PerBook {
  listBySection(bookId: string, sectionId: string): Promise<PlanRecord[]>
}

export interface VisualsRepo extends KeyedRepo<VisualRecord>, PerBook {
  listBySection(bookId: string, sectionId: string): Promise<VisualRecord[]>
  listByPlanItem(planItemId: string): Promise<VisualRecord[]>
}

export interface TracesRepo extends KeyedRepo<TraceRecord>, PerBook {
  listByCodeBlock(codeBlockId: string): Promise<TraceRecord[]>
}

export interface LlmLogRepo {
  add(entry: LlmLogEntry): Promise<number>
  /** Newest first. */
  list(filter?: { role?: RoleName; since?: number; limit?: number }): Promise<LlmLogEntry[]>
}

export interface SettingsRepo {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  list(): Promise<SettingRecord[]>
}

/** All stores together. `transaction` runs `fn` atomically over the named stores (Dexie `rw` transaction). */
export interface IllusRepos {
  books: BooksRepo
  sections: SectionsRepo
  blocks: BlocksRepo
  crossRefs: CrossRefsRepo
  sectionIndex: SectionIndexRepo
  concepts: ConceptsRepo
  conceptModels: ConceptModelsRepo
  plans: PlansRepo
  visuals: VisualsRepo
  traces: TracesRepo
  llmLog: LlmLogRepo
  settings: SettingsRepo
  transaction<T>(stores: readonly StoreName[], fn: () => Promise<T>): Promise<T>
}
