# @illus/store

Dexie implementation of every `@illus/core` repository interface, in its own IndexedDB database `illus`
(separate from Flow's `re-reader`), plus cache export/import and the §15 storage policy.

- Owner: W2
- Spec: §5 (stores, cache keys), §15 (cache lifecycle), §2 D10
- Dexie 4.4.6. Tests run on `fake-indexeddb` (dev only, ADR 0006).

## Public API

| Export | What it does |
| --- | --- |
| `openIllusDb(opts?)` | Opens the `illus` database at the latest version (`DB_VERSION`). `opts.indexedDB`/`IDBKeyRange` inject a fake in tests; `opts.version` opens an older version (migration tests). |
| `SCHEMA_VERSIONS`, `DB_VERSION`, `DB_NAME` | Versioned store schemas. v1 = the §5 table; v2 adds `bookId`/`createdAt` indexes on `plans`, `visuals`, `traces`. Versions are append-only. |
| `createDexieRepos(db)` | `IllusRepos` over the database. Validates every record with its `@illus/core` schema on write, like the in-memory fakes. `transaction(stores, fn)` is a Dexie `rw` transaction. |
| `exportCache(repos, bookId)` → `Blob` | One JSON file with the book row, index (sections, blocks, cross-refs, section index, concepts), concept models, plans, visuals and traces. `collectCache` returns the object. `llmLog` and settings are not exported. |
| `importCache(repos, file)` | Validates a cache file (`Blob`, string or object) and atomically replaces that book's records. Rejects records of another book before writing anything. |
| `requestPersistence(settings, storage?)` | Calls `navigator.storage.persist()` once (first run) and remembers the answer in settings. |
| `enforceStorageBudget(db, opts?)` | Above 500 MB (`navigator.storage.estimate()`), evicts the oldest stale cache records, then the oldest non-pinned ones, until under budget. Pinned visuals and book index data are never evicted. |

`exportCache`/`importCache` take any `IllusRepos`, so they also work with `createMemoryRepos()` from `@illus/core/testing`.

## Example

```ts
import { createDexieRepos, enforceStorageBudget, exportCache, importCache, openIllusDb, requestPersistence } from '@illus/store'

const db = openIllusDb()
const repos = createDexieRepos(db)
await requestPersistence(repos.settings)
await enforceStorageBudget(db)

await repos.visuals.put(record)
const blob = await exportCache(repos, bookId) // save as `${bookId}.illus.json`
await importCache(repos, file) // a File from <input type="file">
```

## Adding a store version

Copy the latest entry of `SCHEMA_VERSIONS` to `n + 1`, change it, and add a test in `test/store.test.ts` that writes rows at version `n` (`openIllusDb({ version: n })`) and reads them at `n + 1`. If existing rows need rewriting, add a Dexie `.upgrade()` for that version in `openIllusDb`.

## Scripts

- `pnpm lint` · `pnpm typecheck` · `pnpm test`
