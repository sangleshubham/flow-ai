// Public API of @illus/store (§5 stores, §15 cache lifecycle). Owner: W2.
export { DB_NAME, DB_VERSION, SCHEMA_VERSIONS, openIllusDb } from './db.ts'
export type { IllusDb, OpenOptions } from './db.ts'
export { createDexieRepos } from './repos.ts'
export { CACHE_FILE_FORMAT, CACHE_FILE_VERSION, CacheFile, collectCache, exportCache, importCache } from './cache-file.ts'
export type { ImportSummary } from './cache-file.ts'
export { STORAGE_BUDGET_BYTES, enforceStorageBudget, requestPersistence } from './storage.ts'
export type { EvictionResult, StorageLike } from './storage.ts'
