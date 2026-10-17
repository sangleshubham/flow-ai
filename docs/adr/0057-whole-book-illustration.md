# 0057 — Whole-book illustration run and a 2 s dwell

- Status: accepted
- Date: 2026-10-17
- Workstream: W3, W9 (W0 flag)
- Spec sections: §2 D4, §15 "Cancellation and concurrency" and "Plan usage controls"; amends ADR 0048

## Context

D4 says illustrations are generated on demand when a section is opened, with no whole-book pre-generation and no prefetch. Shubham asked for a way to illustrate a whole book in one go. For a technical book that is read in many sittings, waiting at every section for the dwell, the planner and the extractors is tedious, and sections he has not reached yet could already be done. ADR 0048 also set the dwell to 5 s, which is longer than needed to tell skimming from reading.

## Decision

1. **An explicit run supersedes D4 for that book.** A per-book run, started by the user from the pane and confirmed on a card that shows an estimate, may generate visuals for every section ahead of reading. D4 still holds for everything else: nothing starts a run on its own, and there is still no automatic prefetch.
2. **The concept pass completes before any planning.** Plan keys do not hash the summary or the glossary, so planning earlier would cache plans made without that context. The run finishes the concept pass first and then plans. A batch that fails twice no longer keeps the pass from completing: once only such sections remain, the pass merges the glossary, writes the summary and marks the book complete, reporting them as `failed`. They stay unindexed until a later `start()` or `indexNow` retries them, and the pipeline plans them with partial context.
3. **Reading order, 2 sections in flight.** The run takes sections in reading order from the current one, with 2 in flight at a time.
4. **The limiter has foreground and background classes.** The total stays at 5 concurrent requests and each class is capped at 4, so background work cannot starve the reader. A queued background request is promoted to foreground at dequeue if the reader asks for the same work.
5. **Core jobs are shared through handles.** Joinable requests for a section the run is already working on attach to the same job. Late joiners get the job history replayed from a single cursor. A cancel releases that holder, and only the last holder aborts the job.
6. **Background jobs skip `sectionSlots`.** Those slots remain the foreground concurrency control for sections the reader opens.
7. **The plan limit pauses the run, and only the user resumes it.** When the plan usage limit is hit, the run stops with "Paused… Resets at …". No timer restarts it. The run also pauses itself, saying why, at the first `signin-required` or `auth` error, and after `MAX_FAILED_IN_A_ROW` (3) sections in a row fail on `upstream` or `timeout` errors, which the gateway has already retried. A section that draws or has nothing to draw resets the count; content failures (schema, validation) never pause the run.
8. **The run lives while the book is open.** It keeps going with the pane closed. It is persisted in settings under `bookRuns`, parsed as untrusted input. Switching to another book pauses it, and coming back resumes it.
9. **The default dwell is 2 s.** `preferences.dwellMs` defaults to 2000 ms, and a one-time migration moves a saved 5000 to 2000. This amends ADR 0048, which is otherwise unchanged. The 0, 2, 5 and 10 s options remain.
10. **The `wholeBook` flag defaults on** in `@illus/core/flags`. Done when the merge gate is green and Shubham has done one live whole-book run.

## Consequences

- The whole book costs requests up front, against the plan limit.
- With `conceptModels` on, parallel sections may patch out of order. The existing catch-up and rebase in `packages/illus-concepts/src/models/generate.ts` handle this at the price of some extra calls.
- Critic calls (flag off) and the concept pass still bypass the limiter.
- Pausing aborts in-flight background calls. Their work is lost and redone on resume.
- There is no auto-eviction (`enforceStorageBudget` is still never called), so a large book grows IndexedDB.
- `currentJob?.cancel()` in the runtime now releases a handle instead of aborting the job.

## Tests

- `packages/illus-pipeline/test/limiter.test.ts` (background class, caps, promotion)
- `packages/illus-pipeline/test/pipeline.test.ts` (`shared jobs (ADR 0057)`)
- `packages/illus-pipeline/test/book-run.test.ts` and the replay integration test over `fixtures/books/synthetic.epub`
- `packages/illus-core` flag tests (`wholeBook`)
- `apps/reader/src/illustrate/state.test.ts` (dwell default and migration, `applyBookRunProgress`, `PersistedBookRun` parsing)
- `apps/reader/src/illustrate/runtime.test.ts`
- `apps/reader/src/illustrate/PaneContent.test.tsx` and `IllustrateSettings.test.tsx`
