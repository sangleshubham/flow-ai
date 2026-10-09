// Storage persistence and the eviction policy (§15 "Cache lifecycle"): request persistent storage on first
// run; above 500 MB evict the oldest stale cache records first, then the oldest non-pinned ones. Pinned
// visuals are never evicted (ADR 0007). Book index data is not evicted: re-indexing costs plan usage.
import type { SettingsRepo } from '@illus/core'

import type { IllusDb } from './db.ts'

export const STORAGE_BUDGET_BYTES = 500 * 1024 * 1024
const PERSIST_KEY = 'storage.persistRequested'

/** Subset of `navigator.storage` used here (injectable for tests). */
export interface StorageLike {
  persist?(): Promise<boolean>
  estimate?(): Promise<{ usage?: number; quota?: number }>
}

const browserStorage = (): StorageLike | undefined => (globalThis as { navigator?: { storage?: StorageLike } }).navigator?.storage

/** Calls `navigator.storage.persist()` once (first run) and remembers the answer in settings. */
export async function requestPersistence(settings: SettingsRepo, storage: StorageLike | undefined = browserStorage()): Promise<boolean | undefined> {
  const previous = await settings.get<{ granted: boolean }>(PERSIST_KEY)
  if (previous) return previous.granted
  if (!storage?.persist) return undefined
  const granted = await storage.persist().catch(() => false)
  await settings.set(PERSIST_KEY, { granted, at: Date.now() })
  return granted
}

const CACHE_STORES = ['visuals', 'plans', 'traces'] as const

interface CacheRow {
  cacheKey: string
  createdAt: number
  stale: boolean
  pinned?: boolean
}

export interface EvictionResult {
  evicted: number
  usageBefore: number | undefined
  usageAfter: number | undefined
}

/**
 * When estimated usage exceeds `budgetBytes`, deletes cache records in batches (oldest stale first, then
 * oldest non-pinned), re-estimating after each batch, until usage is under budget or nothing is left.
 */
export async function enforceStorageBudget(
  db: IllusDb,
  o: { storage?: StorageLike | undefined; budgetBytes?: number; batchSize?: number } = {},
): Promise<EvictionResult> {
  const storage = 'storage' in o ? o.storage : browserStorage()
  const budget = o.budgetBytes ?? STORAGE_BUDGET_BYTES
  const usage = async () => (await storage?.estimate?.())?.usage
  const before = await usage()
  if (before === undefined || before <= budget) return { evicted: 0, usageBefore: before, usageAfter: before }

  // ponytail: loads every cache row's key fields into memory; fine for one reader's cache (thousands of rows).
  const rows: (CacheRow & { store: (typeof CACHE_STORES)[number] })[] = []
  for (const store of CACHE_STORES) {
    await db[store].each((r) => {
      const { cacheKey, createdAt, stale, pinned } = r as CacheRow
      rows.push({ store, cacheKey, createdAt, stale, ...(pinned && { pinned }) })
    })
  }
  const order = [
    ...rows.filter((r) => r.stale && !r.pinned).sort((a, b) => a.createdAt - b.createdAt),
    ...rows.filter((r) => !r.stale && !r.pinned).sort((a, b) => a.createdAt - b.createdAt),
  ]
  const batch = o.batchSize ?? 50
  let evicted = 0
  let now: number | undefined = before
  for (let i = 0; i < order.length && now !== undefined && now > budget; i += batch) {
    const chunk = order.slice(i, i + batch)
    await db.transaction('rw', [...CACHE_STORES], async () => {
      for (const store of CACHE_STORES) await db[store].bulkDelete(chunk.filter((r) => r.store === store).map((r) => r.cacheKey))
    })
    evicted += chunk.length
    now = await usage()
  }
  return { evicted, usageBefore: before, usageAfter: now }
}
