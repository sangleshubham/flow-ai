# Implementation plan: whole-book illustration run, and a 2 s dwell

> **For the executor (Sonnet or Opus, medium effort).** Do the steps in order. Each step is one commit, and its tests go in the same commit.
>
> **Rules:**
>
> - Read `CLAUDE.md` first.
> - `ILLUS_LLM_MODE=replay` always. Never make a live model call, and never run `pnpm eval`.
> - Run `pnpm turbo run lint typecheck test` after each step. Don't move on while it is red.
> - Line numbers are from `main` at `7877a75`. Re-check them before editing.
> - Commit messages start with the workstream in brackets (`W0:`, `W3:`, `W9:`). End every commit message with the attribution lines the session asks for.

---

## 0. Context and decisions

**Today.** A section is illustrated only when the reader opens it:

- after a 5 s dwell (ADR 0048), or
- at once if it already has a cached plan (`dwellDelay` in `apps/reader/src/illustrate/state.ts:56`).

**Goal.** Shubham wants to illustrate a whole book once and keep it cached, so he doesn't click Illustrate section after section.

**Decided with Shubham. Do not reopen these:**

| Topic                                 | Decision                                                                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger                               | A per-book **Illustrate whole book** button, after a confirm card with a rough request estimate. On-demand illustration stays the default.                           |
| Order                                 | Section by section in reading order (`ordinal`).                                                                                                                     |
| Parallelism                           | "Balanced": **2 sections in flight, at most 4 background LLM calls**. The section being read always goes first (1 reserved slot, total cap 5).                       |
| Scope                                 | Runs while the book is open, **even with the Illustrate pane closed**. Closing or switching the book tab pauses it, and reopening the book resumes it automatically. |
| Plan limit (ChatGPT 429 `plan-limit`) | **Pause. The user must click Resume.** Never auto-resume, not even after the reset time.                                                                             |
| Selected text                         | "Illustrate selection" stays on the fly: foreground, never joined with the run, never part of it.                                                                    |
| Dwell                                 | The default changes from 5 s to **2 s**. A saved 5000 migrates to 2000 once.                                                                                         |

Spec D4 (`docs/spec.md:52`) forbids whole-book pre-generation, so this needs ADR 0057 (step 8).

## 1. Branch setup

```bash
git switch main && git pull --ff-only   # main is at 7877a75 or later
git switch -c feat/whole-book-illustrate
```

- `human_testing/` is untracked on `main`. Never `git add` it. Use `git add <paths>` and never `git add -A`.
- Never merge into `main`. Shubham tests the branch and merges it himself.

## 2. What exists (reuse it)

| Thing                   | Where                                                                                                                                     | Note                                                                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Section job             | `packages/illus-pipeline/src/pipeline.ts`: `requestSection` :1292, `start()` :356, `runJob` :395, `Job` class :323                        | Cache-first: a cached section makes **0 LLM calls**, so the run resumes by simply re-walking every section.                                                                                                                                      |
| Limiter                 | `packages/illus-pipeline/src/limiter.ts`                                                                                                  | Plain FIFO. `limitLlm` wraps `LlmCall`.                                                                                                                                                                                                          |
| Limits                  | `pipeline.ts:59-61`: `INDEX_WAIT_MS`, `MAX_LLM_REQUESTS = 4`, `MAX_SECTIONS = 2`                                                          | `index.ts` exports them. Nothing outside the package uses them.                                                                                                                                                                                  |
| Cancel-others rule      | `pipeline.ts:369-371`                                                                                                                     | Cancels every other section's job unless `keepOthers`.                                                                                                                                                                                           |
| Concept pass            | `packages/illus-concepts/src/pass.ts`: `start()` resolves `{indexed,total,done,error?}`, and `running` resets in `finally`                | The app never calls `start()` today, only `indexNow` (lazily).                                                                                                                                                                                   |
| Context                 | `packages/illus-context/src/pack.ts`                                                                                                      | Reads only the concept-pass output, never other sections' visuals. So sections can run in parallel, **but only after the concept pass completes**: plan keys don't hash the summary or glossary, so an earlier plan would freeze weaker context. |
| Runtime                 | `apps/reader/src/illustrate/runtime.ts`                                                                                                   | `activate` :200, `deactivate` :182, `onLocation` :341, `requestVisual` :413, `illustrateSelection` :436, `showCached` :466, `estimateIndexUsage` used at :306                                                                                    |
| Pane state              | `apps/reader/src/illustrate/state.ts`                                                                                                     | `PaneState` :87, `createPaneState` :120, `bindJob` :152, dwell helpers :45-77                                                                                                                                                                    |
| Pane mount              | `apps/reader/src/illustrate/IllustratePane.tsx:41-49`                                                                                     | One effect activates or deactivates on tab, rendition **and `s.open`**. Its cleanup is `deactivate`.                                                                                                                                             |
| Pane UI                 | `apps/reader/src/illustrate/PaneContent.tsx`                                                                                              | `PaneCommands` :13, header :58, `indexing-required` card :100 (the pattern for the confirm card)                                                                                                                                                 |
| Settings                | `apps/reader/src/illustrate/IllustrateSettings.tsx:151-190`                                                                               | "Current book's illustrations" actions. Flag labels :130-138.                                                                                                                                                                                    |
| Flags                   | `packages/illus-core/src/flags/index.ts`                                                                                                  | `FlagName`, `FLAG_OWNERS`, `DEFAULT_FLAGS`                                                                                                                                                                                                       |
| `LlmError.retryAfterMs` | `packages/illus-core/src/schemas/llm.ts:299`                                                                                              | Already exists.                                                                                                                                                                                                                                  |
| Usage                   | `pane.usage.pausedUntil` via `refreshUsage()` (`runtime.ts:156`)                                                                          | The gateway's authoritative plan-limit reset time.                                                                                                                                                                                               |
| Test helpers            | `packages/illus-pipeline/test/helpers.ts`: `fakeLlm`, `seededRepos`, `pipelineWith`, `collect`, `SECTION_LEADERS_ID`, `SECTION_COMMIT_ID` | Model new tests on `pipeline.test.ts`.                                                                                                                                                                                                           |
| Replay end-to-end       | `packages/illus-pipeline/test/synthetic.e2e.test.ts`                                                                                      | Concept pass + pipeline over `fixtures/books/synthetic.epub` with replay fixtures. Reuse its `beforeAll` for the book-run integration test.                                                                                                      |

## 3. Bugs the feature would hit if wired naively (each step below fixes one)

1. **Navigating kills the run.** Foreground `requestSection` cancels every other job (`pipeline.ts:369`), and `onLocation` and `requestVisual` cancel `currentJob`.
2. **The section being read waits behind the run.** The LLM limiter and `sectionSlots` are FIFO, so the run would hold both section slots and fill the call queue.
3. **Duplicate calls.** Opening section S while the run is generating S starts a second job, and nothing is cached yet.
4. **Closing the pane tears everything down** (`IllustratePane.tsx:41-49`).
5. **A saved 5 s dwell survives a default change.** `togglePane` → `savePreferences` persists `dwellMs: 5000`.

---

## Step A: `W9: lower the default dwell to 2 s` (smallest step, do it first)

Files: `apps/reader/src/illustrate/state.ts`, `runtime.ts`, `state.test.ts`, plus `PaneContent.test.tsx` only if it asserts the default.

1. In `state.ts`, set `DEFAULT_PREFERENCES.dwellMs` to `2000`. `parseDwellMs` already falls back to `DEFAULT_PREFERENCES.dwellMs`. Leave `DWELL_OPTIONS_MS` unchanged.
2. Add `prefsVersion?: number` to the stored shape. Keep it **out of** the `Preferences` interface: it is a storage detail. Add `export const PREFS_VERSION = 2` and a pure helper in `state.ts`:
   ```ts
   /** ADR 0057: 5 s was the only default before v2, so a saved 5000 from v1 means "default" → 2000. */
   export const migrateDwellMs = (saved: {
     dwellMs?: unknown
     prefsVersion?: unknown
   }) =>
     (typeof saved.prefsVersion === 'number' ? saved.prefsVersion : 1) < 2 &&
     saved.dwellMs === 5000
       ? 2000
       : parseDwellMs(saved.dwellMs)
   ```
3. In `runtime.ts` `loadPreferences` (:131), use `dwellMs: migrateDwellMs(p)`. In `savePreferences` (:145), write `{ ...pane.preferences, prefsVersion: PREFS_VERSION }`.
4. Tests in `state.test.ts`, in the `describe('dwell before generating (ADR 0048)')` block at :278:
   - the default is 2000;
   - `migrateDwellMs({dwellMs: 5000})` → 2000;
   - `{dwellMs: 5000, prefsVersion: 2}` → 5000;
   - `{dwellMs: 10000}` → 10000;
   - garbage → 2000.
5. Grep for other 5 s assumptions: `grep -rn "5000\|5 s\|5s" apps/reader/src/illustrate apps/reader/e2e`. `PaneContent.test.tsx:237-258` uses an explicit `dwellUntil`, so it is fine. ADR 0048 is amended by ADR 0057 (step H); don't edit 0048.

## Step B: `W3: give the request limiter a background class`

Files: `packages/illus-pipeline/src/limiter.ts`, a new `packages/illus-pipeline/test/limiter.test.ts`, `src/index.ts`.

1. Change the API in a backward-compatible way:
   ```ts
   export type Priority = 'foreground' | 'background'
   export interface LimiterOptions {
     maxForeground?: number
     maxBackground?: number
   }
   export function createLimiter(
     concurrency: number,
     opts: LimiterOptions = {},
   ): Limiter
   // run<T>(fn, signal?, priority?: () => Priority): Promise<T>   (default priority: foreground)
   ```
2. Keep the queue as entries `{ start, priority }`. `next()` loops while `active < concurrency`:
   - First, pick the **oldest foreground** entry if `activeForeground < (maxForeground ?? concurrency)`.
   - Otherwise, pick the oldest background entry if `activeBackground < (maxBackground ?? concurrency)`.
   - Otherwise stop.
   - Call `priority()` **at dequeue time**, so a job promoted to foreground jumps the queue.
   - Track `activeForeground` and `activeBackground` by the class the task **started** with, and decrement the same counter in `finally`.
3. Abort-while-queued behaviour stays exactly as today.
4. Expose `readonly activeBackground: number` for tests.
5. `limitLlm(llm, limiter, priorityOf?: (signal?: AbortSignal) => Priority)` passes `() => priorityOf?.(opts?.signal) ?? 'foreground'`.
6. Export `Priority` and `LimiterOptions` from `index.ts`.
7. Tests:
   - the existing FIFO behaviour within one class;
   - a queued foreground task starts before older background ones;
   - background never exceeds `maxBackground` even when total slots are free;
   - with total 5 and both caps at 4, a foreground task starts while 4 background tasks run;
   - dynamic promotion (`priority` flips from background to foreground while queued);
   - abort while queued rejects with `LlmError('aborted')` and starts the next task.

## Step C: `W3: share section jobs between the reader and a background run`

File: `packages/illus-pipeline/src/pipeline.ts`. This is the hardest step, so keep the diff tight.

### C1. New constants and options

- `pipeline.ts:59-61`: add `MAX_LLM_REQUESTS_TOTAL = 5` and `MAX_BACKGROUND_LLM_REQUESTS = 4`. `MAX_LLM_REQUESTS = 4` stays the **per-class foreground** cap. `MAX_SECTIONS = 2` stays the foreground section-slot count.
- `PipelineDeps`: add optional `maxBackgroundLlmRequests`.
- `RequestOptions` (:121): add
  ```ts
  /** ADR 0057: a whole-book run's request. Skips `sectionSlots`; its calls queue behind the reader's. */
  background?: boolean
  ```
- Construct the limiter as `createLimiter(MAX_LLM_REQUESTS_TOTAL, { maxForeground: deps.maxLlmRequests ?? MAX_LLM_REQUESTS, maxBackground: deps.maxBackgroundLlmRequests ?? MAX_BACKGROUND_LLM_REQUESTS })`.
- Priority lookup: `const bySignal = new WeakMap<AbortSignal, Job>()`. Register it in the `Job` constructor (`bySignal.set(this.controller.signal, this)`). Then:
  ```ts
  limitLlm(deps.llm, limiter, (signal) =>
    signal &&
    bySignal.get(signal)?.background === true &&
    !bySignal.get(signal)!.foregroundHeld
      ? 'background'
      : 'foreground',
  )
  ```
  Every existing `llm.call(..., { signal: job.controller.signal })` site (:493, :766, :778, :905, :924, :1113, :1209) then works unchanged. Verify each one passes the job's signal.

### C2. Core job and handles

- `Job` (:323) stays the **core**. Its existing fields are untouched, so `runJob` and `runItem` don't change. Add:
  - `background: boolean`, set from opts;
  - `joinable: boolean`: `!opts.force && !opts.instruction && !opts.kindOverride && !opts.planItemId && !selection`;
  - `history: { type: SectionJobEvent; payload: unknown }[]`;
  - `holders = new Set<Handle>()`;
  - `get foregroundHeld()`: any holder with `!h.background`.
- `emit` pushes to `history` (still dropping non-`done` events after cancel, as now), then calls `h.deliver()` for every holder. Listeners move from `Job` to `Handle`.
- New `class Handle implements SectionJob`:
  - `background`, `cancelled = false`, `finished`, a `listeners` map, `cursor = 0`, `ready = false`.
  - The constructor runs `queueMicrotask(() => { this.ready = true; this.deliver() })`. Callers subscribe synchronously after `requestSection` returns, as they do today. Late joiners then get the **full history in true order**, followed by live events, with no duplicates.
  - `deliver()`: if `!ready`, return. While `cursor < core.history.length`, send `history[cursor++]` to matching listeners. Skip non-`done` events once `this.cancelled`. When the event is `done`, resolve `finished`.
  - `get sectionId()` returns `core.sectionId`, because merge resolution mutates it.
  - `cancel()`: if already cancelled, return. Set `cancelled = true`, delete `this` from `core.holders`, then:
    - if `core.holders.size === 0`, call `core.cancel()`; the core's normal `done` then reaches this handle;
    - otherwise, emit a local `done {cancelled:true}` to this handle's listeners on a microtask and resolve `finished`. The core keeps running for the other holder, now at background priority if only the run holds it.
- `start()` (:356) becomes:
  1. `const handle = new Handle(core, !!opts.background)`.
  2. Join: if `core.joinable`, look in `const inflight = new Map<string, Job>()`, keyed by **requested** section id. If an existing **joinable** core is not cancelled, add the handle to it, set `existing.background &&= !!opts.background`, and return the handle. Don't start anything new. The reader's ids are already merge-resolved by the bridge, and the run passes non-merged ids, so keying by the requested id is enough.
  3. Otherwise:
     - Keep today's cancel-others rule, rewritten to **release foreground handles of other sections** rather than calling `core.cancel()`. Background handles are never released by it.
     - Add the core to `jobs` and `inflight`, then add the handle.
     - Run it: if `opts.background`, call `runJob` directly; otherwise go through `sectionSlots.run(...)` as today.
     - In `finally`, delete the core from `inflight` and `jobs`, then emit `done`.
     - Return the handle.
  4. The `jobs` set holds cores. The cancel-others loop iterates cores' foreground holders.
- `requestSelection` never joins (`joinable = false`).

### C3. Plan-limit reset time on events

- `SectionJobEvents`: add an optional `retryAfterMs?: number` to `error` and `item-failed`.
- Set it when the cause is an `LlmError` with `retryAfterMs`:
  - the `start()` catch (:380);
  - the `item-failed` emit (:576): give `ItemFailure` an optional `retryAfterMs`, built from the `LlmError`.

### C4. Tests

Add a `describe('shared jobs (ADR 0057)')` block to `packages/illus-pipeline/test/pipeline.test.ts`, using `fakeLlm` with a gate promise to hold calls open:

1. A background request for L, then a foreground request for L while the planner is pending:
   - **exactly one** planner call and one extractor call;
   - both handles get `plan` → `item-ready` → `done`;
   - the late handle's event order equals the early handle's.
2. Foreground handle cancel while the background handle holds the job:
   - no abort (the planner signal is not aborted);
   - the background handle still gets `item-ready`;
   - the foreground handle gets `done {cancelled:true}`.
3. The last holder's cancel aborts. This keeps the existing test "navigating away cancels the planner…" at :399 green unchanged.
4. Background requests don't take `sectionSlots`: with `maxSections: 1`, a background job for C and a foreground job for L both reach the planner.
5. Priority:
   - with `maxBackgroundLlmRequests: 1` and a background job holding its call, a foreground job's call starts at once;
   - when a foreground handle joins a background core, the core's queued calls are classed as foreground.
6. `force`, `instruction` and `requestSelection` never join (2 planner calls).
7. A foreground request for another section does **not** cancel a background job, but does cancel the earlier foreground job (the existing behaviour).
8. `item-failed` and `error` carry `retryAfterMs` from a `LlmError('plan-limit', …, { retryAfterMs })`.

Keep every existing pipeline, trace and synthetic test green. If one breaks only because of event timing, the handle microtask is the likely cause. Fix the handle, not the test.

## Step D: `W3: add the whole-book run`

New file `packages/illus-pipeline/src/book-run.ts`. Export it from `src/index.ts`. It must stay pure and DOM-free (golden rule 3), and it is written test-first.

```ts
import type { SectionNode } from '@illus/core'
import type { ConceptPass } from '@illus/concepts' // check @illus/pipeline already depends on @illus/concepts (it does: createConceptModels)
import type { Pipeline } from './pipeline.ts'

export const BOOK_RUN_SECTIONS = 2
/** Rough requests per uncached section: planner + ~2 items × (extractor + animator). Shown as "about". */
export const REQUESTS_PER_SECTION = 5

export type BookRunStatus =
  | 'understanding'
  | 'illustrating'
  | 'paused'
  | 'paused-limit'
  | 'done'
export interface BookRunProgress {
  status: BookRunStatus
  total: number // target sections
  finished: number // target sections whose job reached `done` this run (cached ones count, instantly)
  noVisual: number
  failedItems: number
  inProgress: string[] // section ids
  indexed?: { indexed: number; total: number } // during 'understanding'
  retryAfterMs?: number // set with 'paused-limit'
}
export interface BookRun {
  start(): Promise<BookRunProgress> // idempotent while running
  pause(): void // releases its handles; resolves start() with 'paused'
  readonly progress: BookRunProgress
}

/** Sections a run illustrates: not merged into another, with at least one block, in reading order. */
export function bookRunTargets(sections: readonly SectionNode[]): SectionNode[]
export function estimateBookRun(o: {
  uncachedSections: number
  indexRequests: number
}): number

export function createBookRun(deps: {
  pipeline: Pick<Pipeline, 'requestSection'>
  concepts: Pick<ConceptPass, 'start'>
  sections: readonly SectionNode[]
  concurrency?: number
  onProgress?(p: BookRunProgress): void
}): BookRun
```

How `start()` works:

1. **Understanding.** Set status `understanding`, then `await concepts.start()`.
   - `error?.code === 'plan-limit'`: return `paused-limit` with `retryAfterMs`.
   - Any other `error`, or `!done`: return `paused`, so the user can Resume. The concept pass retries failed batches on its next `start()`.
   - Check `paused` after the await.
2. **Illustrating.**
   - Build a queue from `bookRunTargets(sections)` and start `concurrency` workers.
   - Each worker shifts a section and calls `const h = pipeline.requestSection(id, { background: true, keepOthers: true })`, keeping `h` in a `Set` so `pause()` can call `h.cancel()`.
   - It subscribes to `no-visual` (noVisual++), `item-failed`, `error` and `done`, then `await h.finished`.
   - On `item-failed` or `error` with `code === 'plan-limit'`: set `limitHit = { retryAfterMs }`, stop taking new sections, and cancel every held handle.
   - `item-failed` with any other code: `failedItems++`.
   - `error` with any other code: count as 1 failed item and continue.
   - On `done`: `finished++`, remove the section from `inProgress`, and call `onProgress`.
3. **Result.** `limitHit` → `paused-limit`. Pause requested → `paused`. Otherwise `done`.

Tests in a new `packages/illus-pipeline/test/book-run.test.ts`, with a fake pipeline whose handles are driven manually and a fake `concepts`:

- `bookRunTargets` skips `mergedInto` and sections without blocks, sorted by `ordinal`;
- the concept pass is awaited before any `requestSection`, and its plan limit becomes `paused-limit` without requesting anything;
- never more than `concurrency` handles open at once, requested in ordinal order;
- every request carries `{ background: true, keepOthers: true }`;
- a plan-limit `item-failed` cancels the open handles, starts no new section, and returns `paused-limit` with `retryAfterMs`;
- `pause()` cancels the open handles and returns `paused`;
- a full pass returns `done` with the counts;
- `estimateBookRun` arithmetic.

Integration test: add a `describe` to `synthetic.e2e.test.ts`, or a new `book-run.e2e.test.ts` reusing the same `beforeAll` (move shared setup into a helper only if it is cheap).

- Run `createBookRun` over `book.sections` with the real pipeline on replay fixtures, `flags: { templates: true, animations: false }` as in that file.
- Assert:
  - status `done`;
  - every target section has a plan record (`repos.plans.listBySection`);
  - a **second** `start()` on a fresh run makes **zero** transport calls (count calls in the tracking fixture store or the transport).
- If some target sections have no hand-written planner fixture (compare `bookRunTargets` with the `PLANS` keys in `test/fixtures/synthetic-calls.ts`), add hand-written `PLANS` entries (`needsVisual: false` is enough) and regenerate with `ILLUS_WRITE_FIXTURES=1 pnpm --filter @illus/pipeline fixtures:llm`. That is W3-owned and allowed; fixtures carry `"source": "handwritten"`. The test "every committed W3 fixture is hand-written and used" must stay green.

## Step E: `W0: add the wholeBook flag`

- `packages/illus-core/src/flags/index.ts`: add `'wholeBook'` to `FlagName`, `wholeBook: 'W9'` to `FLAG_OWNERS`, and `wholeBook: true` to `DEFAULT_FLAGS`. It defaults on because Shubham asked for the feature; ADR 0057 records why.
- It is **not** a kind flag. Confirm that `KIND_FLAG` (`pipeline.ts:236`) and the plan-key `kinds` list don't pick it up; adding it must not change any plan key.
- `IllustrateSettings.tsx:130-138`: label `wholeBook: 'Whole-book illustration'`.
- Update any test that snapshots `FlagName.options`, `DEFAULT_FLAGS` or the settings checkboxes (`grep -rn "htmlFallback" --include=*.test.* .` finds them).

## Step F: `W9: run a whole book from the reader runtime`

Files: `apps/reader/src/illustrate/state.ts`, `runtime.ts`, `IllustratePane.tsx`, `state.test.ts`, `runtime.test.ts`.

### F1. State (`state.ts`)

```ts
export type BookRunUiStatus =
  | 'idle'
  | 'confirm'
  | 'understanding'
  | 'illustrating'
  | 'paused'
  | 'paused-limit'
  | 'done'
export interface BookRunState {
  status: BookRunUiStatus
  total: number
  finished: number
  noVisual: number
  failedItems: number
  inProgress: string[]
  /** Sections with a saved plan, counted when the book activates and after the run. */
  cachedCount: number
  estimate: number | null // requests, while 'confirm'
  resetAt: number | null // epoch ms, while 'paused-limit'
}
```

- Add `bookRun: BookRunState` and `runningBooks: string[]` (Flow book ids whose persisted run is `running`) to `PaneState` and `createPaneState`.
- Persisted value, under the settings key `bookRun:<flowBookId>`:
  ```ts
  export const PersistedBookRun = z.object({
    status: z.enum(['running', 'paused', 'paused-limit']),
    resetAt: z.number().optional(),
  })
  ```
  Parse it with `safeParse`; stored settings are untrusted, as `loadPreferences` already treats them. Use `zod` if the app already imports it (check `apps/reader/package.json`). Otherwise write a small hand-written guard in the style of `loadPreferences`.
- Pure helper `applyBookRunProgress(state, p)`: maps a `BookRunProgress` onto `state.bookRun`. Tests go in `state.test.ts`.

### F2. Runtime (`runtime.ts`)

Module state: `let run: BookRun | null`, plus `active.flowBookId = tab.book.id`. Add `flowBookId` to the `active` object built at :299.

- **`loadPreferences`:** also load every settings key `bookRun:*` with `status === 'running'` into `pane.runningBooks`. If the settings repo has no prefix listing, store one index key `bookRuns` (`Record<flowBookId, PersistedBookRun>`) instead of one key per book. **Prefer the single `bookRuns` key**; it is simpler.
- **`activate(tab)`:**
  - At the top: if `active` already exists for the same `tab.book.id` and the same `rendition`, call `paneOpened()` and return. This makes it idempotent.
  - At the end, after `pane.indexingApproved` is computed and the listeners are attached:
    - compute `pane.bookRun.cachedCount`: for each of `bookRunTargets(sections)`, `(await repos.plans.listBySection(bookId, id)).length > 0`;
    - if the persisted status for `flowBookId` is `running`, call `startBookRun({ resume: true })`. `paused` and `paused-limit` restore their UI status, and `paused-limit` restores `resetAt`.
- **`deactivate()`:** `run?.pause(); run = null`. Do **not** change the persisted status, so a `running` book resumes on reopen. Reset `pane.bookRun.status` to `'idle'` unless it is `paused` or `paused-limit`.
- **`confirmBookRun()`:**
  - `uncached = targets − cachedCount`;
  - `indexRequests = indexStatus === 'complete' ? 0 : pane.estimate?.requests ?? 0`;
  - set `pane.bookRun.estimate = estimateBookRun(...)` and status `confirm`.
- **`cancelBookRunConfirm()`:** back to `idle`.
- **`startBookRun({ resume = false } = {})`:**
  - Guards: `active`, `navigator.onLine`, not already running.
  - If `!pane.indexingApproved`, set it to true and persist `indexingApproved:<bookId>`. Starting the run is the approval, since the confirm card included the indexing estimate.
  - Persist `running` and add the book to `runningBooks`.
  - `run = createBookRun({ pipeline: active.pipeline, concepts: active.concepts, sections: active.sections, onProgress: (p) => own === generation && applyBookRunProgress(pane.bookRun, p) })`.
  - `const result = await run.start()`. Ignore the result if `own !== generation`. Otherwise apply it:
    - `done`: remove the persisted entry and the book from `runningBooks`, recount `cachedCount`, show status `done`.
    - `paused`: from `pauseBookRun`, already persisted. From a concept-pass error, persist `paused` and show the message.
    - `paused-limit`: `await refreshUsage()`, then `resetAt = pane.usage?.pausedUntil ?? (result.retryAfterMs ? Date.now() + result.retryAfterMs : null)`. Persist `{ status: 'paused-limit', resetAt }` and remove the book from `runningBooks`. **No timer, no auto-resume.**
  - Call `refreshUsage()` on progress, throttled (at most every 10 s).
- **`pauseBookRun()`:** persist `paused`, remove the book from `runningBooks`, then `run?.pause()`.
- **`resumeBookRun()`:**
  - If the status is `paused-limit` and `resetAt > Date.now()`: set `pane.message` to `Still paused by the ChatGPT plan limit until <time>.` and return.
  - Otherwise `startBookRun()`. Resuming skips the confirm card.
- **`onLocation`:** after `showCached()` and the offline check, add `if (!pane.open) { pane.status = 'idle'; return }`. With the pane closed, the runtime may now be alive for the run, and it must not start a dwell.
- **`paneClosed()`:** `dwell.cancel()`, `currentJob?.cancel()`, `unbind?.()`, `unbind = undefined`, `currentJob = null`, and `if (!pane.pinned) pane.status = 'idle'`. Keep `active`, the bridge, the pipeline and the run.
- **`paneOpened()`:** `shownSectionId = undefined; active?.bridge.refreshLocation()`. `onLocation` then re-runs `showCached` and the dwell.
- **No other runtime changes:**
  - `requestVisual` keeps calling `requestSection` with no `background`. If the run holds that section, step C joins it: no duplicate calls, promoted to foreground. If the run already finished it, `showCached` finds the plan, the dwell is 0, and it is a pure cache hit.
  - `illustrateSelection` is unchanged.
  - Its `currentJob?.cancel()` now only releases the reader's handle, so the run's work for that section continues.

### F3. Mount (`IllustratePane.tsx:41-49`)

Replace the one effect with two:

```ts
const tab = r.focusedBookTab
const keepAlive = s.open || (!!tab && s.runningBooks.includes(tab.book.id))
useEffect(() => {
  const t = reader.focusedBookTab
  if (keepAlive && t?.rendition && t.epub) void activate(t as any)
  else {
    deactivate()
    if (!pane.pinned) pane.status = 'idle'
  }
  return deactivate
}, [r.focusedBookTab?.id, r.focusedBookTab?.rendition, keepAlive])
useEffect(() => {
  if (s.open) paneOpened()
  else paneClosed()
}, [s.open])
```

- Closing the pane while a run is running keeps `keepAlive` true, so the runtime isn't torn down and only `paneClosed` runs.
- When the run finishes with the pane closed, the book leaves `runningBooks`, `keepAlive` turns false, and the runtime deactivates. That is correct.
- Check that `paneOpened` on first mount (when `activate` hasn't finished) is harmless: `active` is null, so it is a no-op.

### F4. Tests

- `state.test.ts`: `applyBookRunProgress`, and `PersistedBookRun` parse (garbage → ignored).
- `runtime.test.ts`: follow the mocking style already in that file. If the runtime is hard to unit-test there, keep this to the pure helpers and rely on step G's component tests plus manual QA, and say so in the final report.

## Step G: `W9: add the whole-book bar to the pane and settings`

Files: `PaneContent.tsx`, `styles.css`, `IllustratePane.tsx`, `IllustrateSettings.tsx`, `PaneContent.test.tsx`, `IllustrateSettings.test.tsx`.

1. `PaneCommands` gains `bookConfirm()`, `bookStart()`, `bookCancel()`, `bookPause()` and `bookResume()`. Wire them in `IllustratePane.tsx` to `confirmBookRun`, `startBookRun`, `cancelBookRunConfirm`, `pauseBookRun` and `resumeBookRun`.
2. `PaneContent` renders a `<div className="illus-book-run" role="region" aria-label="Whole book">` **between the header and `.illus-meta`**, so it is visible in every pane state. It renders only when `s.bookId && s.preferences.flags.wholeBook`.

   | `s.bookRun.status` | Content                                                                                                                                                                                                                                                                                                                                                                                     |
   | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `idle`             | `{cachedCount} of {total} sections illustrated` · `[Illustrate whole book]`. Disabled when offline, or when `!s.signedIn && s.signinConfigured`. Use `bookRunTargets` from the activation for `total`, stored in `bookRun.total`.                                                                                                                                                           |
   | `confirm`          | A card in the style of the `indexing-required` card: "Illustrate the remaining N sections? This uses about {estimate} requests from your ChatGPT plan (the 5-hour window is shared with ChatGPT). It runs while this book is open, even with this pane closed; the section you're reading always goes first. If the plan limit is reached it pauses until you resume." `[Start]` `[Cancel]` |
   | `understanding`    | `Understanding the book: {indexed} of {total} sections` + `<progress>` + `[Pause]`                                                                                                                                                                                                                                                                                                          |
   | `illustrating`     | `Illustrating book: {finished} / {total}` (+ ` · {failedItems} failed` when > 0) + `<progress value max>` + `[Pause]`                                                                                                                                                                                                                                                                       |
   | `paused`           | `Paused at {finished} / {total}` · `[Resume]`                                                                                                                                                                                                                                                                                                                                               |
   | `paused-limit`     | `Paused: ChatGPT plan limit reached.` + (`resetAt` ? ` Resets at {HH:MM}.` : '') + ` Resume when you're ready.` · `[Resume]`                                                                                                                                                                                                                                                                |
   | `done`             | `Book illustrated` (+ ` · {failedItems} items failed` + `[Retry failed]` → `bookStart`)                                                                                                                                                                                                                                                                                                     |

   Use `aria-live="polite"` on the status line, and use the existing button styles.

3. `styles.css`: a compact bar (small font, a 4 px progress bar using the theme tokens already in that file). Check it in light and dark themes.
4. The rail in the closed pane (`IllustratePane.tsx:83-95`): while the status is `understanding` or `illustrating`, the button's `aria-label` and `title` read `Open Illustrate. Illustrating book {finished} of {total}`, and the rail gets a thin `::after` fill driven by an inline CSS variable `--illus-run-progress`.
5. `IllustrateSettings.tsx` "Current book's illustrations" (:151): add the same status line and one button (Illustrate whole book / Pause / Resume, depending on status), calling the same runtime functions. Hide it when the flag is off.
6. Tests:
   - `PaneContent.test.tsx`: each row of the table renders its text and buttons, and each button fires its command; the bar is hidden when the flag is off or there is no `bookId`; the idle button is disabled offline.
   - `IllustrateSettings.test.tsx`: the button appears and calls the runtime function. Mock it the way that file mocks `downloadCache`.

## Step H: `W3: ADR 0057 whole-book illustration`

Copy `docs/adr/0000-template.md` to `docs/adr/0057-whole-book-illustration.md`.

- **Status:** accepted. **Date:** today. **Workstream:** W3, W9 (W0 flag).
- **Spec sections:** §2 D4, §15 "Cancellation and concurrency" and "Plan usage controls"; also ADR 0048.
- **Context:** Shubham's request, and why on-demand illustration alone is tedious for technical books.
- **Decision:** one numbered point each for:
  1. an explicit, per-book, user-confirmed run supersedes D4;
  2. the concept pass completes before any planning (plan keys don't hash the summary or glossary);
  3. reading order with 2 sections in flight;
  4. the limiter has foreground and background classes, a total of 5 with each class capped at 4, and promotion at dequeue;
  5. shared core jobs with handles: joinable requests attach, late joiners get the history replayed, a cancel releases a holder, and only the last holder aborts;
  6. background jobs skip `sectionSlots`;
  7. the plan limit pauses the run, and only the user resumes it;
  8. the run lives while the book is open, even with the pane closed, and is persisted in settings `bookRuns`;
  9. the default dwell is 2 s with a one-time migration of a saved 5000 (amends ADR 0048);
  10. the `wholeBook` flag defaults on. Done when: the merge gate is green plus one live whole-book run by Shubham.
- **Consequences:**
  - the whole book costs requests up front;
  - with `conceptModels` on, parallel sections may patch out of order; the existing catch-up and rebase (`illus-concepts/src/models/generate.ts`) handle it at some extra calls;
  - critic calls (flag off) and the concept pass still bypass the limiter;
  - pausing aborts in-flight background calls (their work is lost and redone on resume);
  - no auto-eviction (`enforceStorageBudget` is still never called), so a big book grows IndexedDB.
- **Tests:** list the files from steps B to G.

Also add one line to `apps/reader/src/illustrate/README.md` if it documents pane states or commands.

## Step I: verify and report

1. Run `pnpm turbo run lint typecheck test`. It must be green.
2. Run `pnpm e2e` (Playwright, replay). The existing illustrate flow must pass, and it now waits 2 s instead of 5 s.
   - Add a Playwright test for the bar (idle → confirm → Start → the status line shows `Understanding` or `Illustrating` → Pause → `Paused`) **only if** the replay fixtures make it deterministic.
   - Otherwise state in the report that the bar is covered by component tests only.
3. Manual check in replay mode (`pnpm dev`; use the `run` skill or Playwright to drive it), on `fixtures/books/synthetic.epub`:
   - the bar shows `x of y`;
   - the confirm card shows an estimate;
   - Start → progress;
   - close the pane → the rail shows progress and the run continues;
   - switch to another book → it pauses; switch back → it resumes;
   - Pause/Resume works;
   - open a section the run finished → shows instantly, with no countdown;
   - "Illustrate selection" still works.
4. Final report to Shubham: the branch name, the commits, test results, anything skipped, and the live test below.

**Live test for Shubham only. Never run it yourself.** Check out `feat/whole-book-illustrate`, `pnpm dev`, open a real book, then **Illustrate whole book**. While it runs:

- jump far ahead: that section must illustrate first;
- open a section the run is working on: no duplicate requests for it in `llmLog` (or in the usage counter);
- open a finished section: it appears instantly;
- illustrate a text selection: it works on the fly;
- if the plan limit is hit: the run shows "Paused… Resets at …" and stays paused until Resume.

## Pitfalls checklist (read before you start)

- **Handle replay order.** Deliver history from a single cursor per handle, in a microtask after creation. Never replay per event type.
- **Merged sections.** `job.sectionId` is mutated after merge resolution, so `Handle.sectionId` must read through to the core.
- **Release vs cancel.** `currentJob?.cancel()` in the runtime now releases a handle. That is the intended behaviour, so don't add new cancel paths.
- **Persisted state is untrusted input.** Parse it and default it, as `loadPreferences` does.
- **Generation counter.** Every async continuation in the runtime must check `own === generation`, as the existing code does.
- **Plan limit.** Don't add any `setTimeout` that restarts a paused run.
- **Selection.** Don't touch the selection flow, except that it inherits release semantics.
- **Scope.** Keep each commit to its own step's files. Don't reformat unrelated code.
