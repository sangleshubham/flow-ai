// The `illus` IndexedDB database (§5 "IndexedDB stores"), separate from Flow's `re-reader` (flow-audit §5).
// Versions are append-only: never edit a released version; add the next one with its upgrade.
import { Dexie } from 'dexie'
import type { DexieOptions, Table } from 'dexie'

import type { StoreName } from '@illus/core'

export const DB_NAME = 'illus'

/**
 * Store schemas by version (Dexie syntax: primary key first, `++` auto-increment, `*` multi-entry,
 * `[a+b]` compound).
 * - v1: exactly the §5 table.
 * - v2: `bookId` and `createdAt` on the cache stores, for per-book deletes, export and eviction (§15).
 */
export const SCHEMA_VERSIONS: Readonly<Record<number, Readonly<Record<StoreName, string>>>> = {
  1: {
    books: 'bookId, indexStatus',
    sections: 'sectionId, bookId, [bookId+ordinal]',
    blocks: 'blockId, sectionId',
    crossRefs: '++id, fromBlockId, targetSectionId',
    sectionIndex: 'sectionId, bookId',
    concepts: 'conceptId, bookId, *aliases, canonical',
    conceptModels: 'conceptModelId, bookId, conceptId',
    plans: 'cacheKey, [bookId+sectionId]',
    visuals: 'cacheKey, [bookId+sectionId], planItemId',
    traces: 'cacheKey, codeBlockId',
    llmLog: '++id, role, createdAt',
    settings: 'key',
  },
  2: {
    books: 'bookId, indexStatus',
    sections: 'sectionId, bookId, [bookId+ordinal]',
    blocks: 'blockId, sectionId',
    crossRefs: '++id, fromBlockId, targetSectionId',
    sectionIndex: 'sectionId, bookId',
    concepts: 'conceptId, bookId, *aliases, canonical',
    conceptModels: 'conceptModelId, bookId, conceptId',
    plans: 'cacheKey, [bookId+sectionId], bookId, createdAt',
    visuals: 'cacheKey, [bookId+sectionId], planItemId, bookId, createdAt',
    traces: 'cacheKey, codeBlockId, bookId, createdAt',
    llmLog: '++id, role, createdAt',
    settings: 'key',
  },
}

export const DB_VERSION = Math.max(...Object.keys(SCHEMA_VERSIONS).map(Number))

export type IllusDb = Dexie & { [K in StoreName]: Table<unknown, unknown> }

export interface OpenOptions {
  name?: string
  /** Inject `fake-indexeddb` in tests; browsers use the global IndexedDB. */
  indexedDB?: DexieOptions['indexedDB']
  IDBKeyRange?: DexieOptions['IDBKeyRange']
  /** Open at an older version (migration tests only). */
  version?: number
}

/** Declares every version up to `version` (default: latest). Dexie opens lazily on first use. */
export function openIllusDb(o: OpenOptions = {}): IllusDb {
  const db = new Dexie(o.name ?? DB_NAME, {
    ...(o.indexedDB && { indexedDB: o.indexedDB }),
    ...(o.IDBKeyRange && { IDBKeyRange: o.IDBKeyRange }),
  }) as IllusDb
  const upTo = o.version ?? DB_VERSION
  for (const [v, stores] of Object.entries(SCHEMA_VERSIONS)) if (Number(v) <= upTo) db.version(Number(v)).stores(stores)
  return db
}
