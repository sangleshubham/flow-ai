# 0064 — Resumable whole-book runs with real counts

- Status: proposed
- Date: 2026-10-21
- Workstream: W9, W3
- Spec sections: §5 (cache keys), §15 "Cancellation and concurrency" and "Plan usage controls"; amends ADR 0057 decisions 3 and 8

## Context

Shubham reported three whole-book problems: "Illustration was done near 50% but it started from the start", "most of the time it's stuck at 'Preparing the book'", and "caching is not working well". ADR 0060 fixed the escalated visual keys and the index wait for cached plans, and ADR 0061 kept concept-pass gaps from blocking runs. The remaining causes are in the run state and the resume logic (`apps/reader/src/illustrate/runtime.ts`, `packages/illus-pipeline/src/book-run.ts`):

1. The `bookRuns` setting saved only `{ status, resetAt }`. After a reload the bar showed "Paused at 0 / N", and every `start()` reset `finished` to 0.
2. Resume rotated the targets to the reader's current section, not to where the run stopped.
3. `countCached` and `showCached` accepted any plan or visual stored for a section, whatever its key. After a prompt-version, model or flag change, the pane showed stale visuals as current, the count overstated the cache, and `dwellDelay(cachedPlan = true)` skipped the dwell and then spent requests anyway.
4. If `activate()` threw, `bookRun.total` stayed 0 with `pane.bookId` set, so the bar said "Preparing the book…" forever. A confirm pressed while preparing was dropped after 60 s, and preparing progress never reached the bar.
5. A resume waited on the previous run's `start()` with no visible status and no bound.
6. `waitForIndex` ignored the job's abort signal, so a cancelled job held its section slot for up to `INDEX_WAIT_MS` (20 s, ADR 0060 review). `reindex()` did not clear remembered concept-pass gaps (ADR 0061 follow-up).

## Decision

1. **Current-key cache status in the pipeline.** `Pipeline.sectionCacheStatus(sectionIds)` reports `cached`, `no-visual`, `partial` or `missing` per section. It computes keys the way `runJob` does: the current flags' kinds in the plan key, the planner's expected runs, `lookupRuns` with the ADR 0060 escalated-key fallback for visuals, and `mergedInto` resolution. Reads are batched: one `sections.bulkGet` per merge level, one `plans.bulkGet` and one `visuals.bulkGet` for the whole book. `Pipeline.cachedSection(sectionId)` returns the current plan and every visual made from it, including "Regenerate with instruction" and kind-override records. A record counts as an override to any kind, because a fallback (for example a trace that became a timeline) stores a different kind from the one the override asked for. Records under older keys are left out. `runJob` uses the same key helpers.
2. **"Done" means current.** The reader counts a section as done when its current-key plan and every enabled item's visual are cached, or when its plan says there is nothing to draw. `showCached` shows only current records and skips the dwell only when no model call is needed (`cached` or `no-visual`).
3. **The run starts from what is cached.** `createBookRun` checks `sectionCacheStatus` at every `start()`, before its first report. Cached and `no-visual` sections are finished at once and never requested, so `finished` never drops to 0. A failed check skips nothing. `BookRunProgress` gains `sections` (id → `pending | running | done | cached | failed | no-visual`), `cursor` (the first unfinished section in the run's order), `startedAt`, `sessionDone` and `avgSectionMs`. Only sections that needed a model call count toward the session's count and mean.
4. **A versioned saved record.** `bookRuns[flowBookId]` is now `{ v: 2, status, resetAt?, cursor?, startedAt?, failed?, failedItems? }`. It is written at start, whenever the cursor or failures change while running, and on pause. Version 1 records (`{ status, resetAt }`) are migrated when read, and the next write stores version 2. `migrateBookRuns(value)` is the dry run: it reports `migrated` and `dropped` ids without writing. Rollback needs no step, because builds before this ADR parse the record with a non-strict object schema and drop the new fields. Malformed or future-version entries are dropped one by one, as before.
5. **Resume continues from the cursor.** A saved run (running, paused or paused-limit) starts at its saved `cursor`. A run with no saved record starts at the reader's section, as in ADR 0057. Done and Stop clear the record, so "Retry failed" (a new run after `done`) starts at the reader's section and requests only the sections that are not cached.
6. **Visible preparing, errors and queued requests.** The bar has a `preparing` status with `preparing: { label, done?, total? }` (opening, indexing `spineDone / spineTotal`, loading, checking saved illustrations). If `activate` fails, the status becomes `error` with the message, and the bar's Retry button (`retryActivate()`) sets the book up again. `activate` checks after every read that it is still setting up the same book, so a book switch never writes into the new book's state. If the `wholeBook` flag is turned off during the cache check, the bar goes back to `idle`. If the flag is turned on over an open book, `savePreferences` runs the cache-check step then. A confirm or start pressed before the book is ready is kept in `queued` ("Will start when ready.") with no timeout. When the book is ready, a queued confirm shows the card. A queued start resumes a saved run, or shows the card when no run is saved. A queued start is tied to its book.
7. **Bounded `stopping`.** A start while the previous run is still settling shows `stopping`. Only a run of the same book setup is waited for, because a reopened or different book has its own concept pass. The new run calls `pause()` on the previous run again, then waits at most `STOP_WAIT_MS` (10 s) before going on. Pause is available while `stopping`. If the previous concept pass is still stopping by then, the new run pauses itself rather than hanging.
8. **Stop is distinct from Pause.** `stopBookRun()` ends the run and deletes its saved record, but keeps every cache. The bar goes back to `idle` with the counts from the cache. A stop while the book is still preparing deletes the record and marks the book, so a saved `running` run does not resume once it is ready. `activate` also reads `bookRuns` through the serialized write chain. The UI wiring for Stop comes in the next unit.
9. **Abortable index wait; reindex resets gaps.** `waitForIndex` also races the job's abort signal. `reindex()` calls `resetConceptPassState(repos, bookId)` after deleting the section indexes.

`@illus/core` is unchanged. No IndexedDB schema or shared contract changes; the new pipeline methods and types are additions to `@illus/pipeline`'s public API.

## Consequences

- Reopening a book shows the real done/total, the per-section map and the cursor before anything starts.
- A run, or a resume, makes no requests for sections that are already cached under current keys.
- After a prompt-version, model-route or flag change, old records are no longer shown or counted, and they are regenerated on demand (after the dwell). Offline, a section whose records are all stale shows nothing.
- Resume retries `failed` sections when the wrap-around reaches them, as before.
- Each status check hashes about one plan key per planner run and one visual key per item and run. These are local SHA-256 calls with no model requests.
- `BookRunState` gains `preparing`, `queued`, `sections`, `cursor`, `startedAt` and `session`, and `BookRunUiStatus` gains `preparing`, `stopping` and `error`. The next unit (the progress panel) builds on these fields; the comment on `BookRunState` in `state.ts` documents them and the ETA formula.
- Tests: `packages/illus-pipeline/test/pipeline.test.ts` (`sectionCacheStatus and cachedSection`, `index wait`), `packages/illus-pipeline/test/book-run.test.ts` (`resumable runs`), `apps/reader/src/illustrate/state.test.ts` (`resumable run state`), `apps/reader/src/illustrate/runtime.test.ts` (`resumable whole-book runs`) and `PaneContent.test.tsx`.
