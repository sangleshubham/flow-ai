# 0054 — Parallel plan items and an early item preview

- Status: accepted
- Date: 2026-10-17
- Workstream: W3 (pipeline), W9 (pane)
- Spec sections: §15 "Per-section flow" steps 5–7, §13

## Context

Spec §15 step 5 starts item 1 alone and items 2 and 3 only after it, two at a time. Item 1 runs its whole
chain first (extract, retry, animate, animation repair, critic), so with a graph item and a sequence item
the second extractor waits for all of item 1's calls. Items don't share extraction state, and the global
limiter (4 LLM requests, §15 "Global limits") already bounds load.

Step 7 emits `item-ready` only after animation and review, though the IR is final once it validates. The
reader waits one or two more calls per item to see a diagram that is already decided.

Neither change touches a prompt, schema, validator, model, effort or check, so accuracy is unchanged.

## Decision

1. **Every plan item starts at once** (`packages/illus-pipeline/src/pipeline.ts`). Items are queued in
   priority order, so item 1's calls still enter the global FIFO limiter first. Items that patch the same
   concept model (`conceptModelId ?? newConceptModel`) run one after another, to avoid a read-modify-write
   race in the §13 patch flow.
2. **New `item-preview` event** `{ planItemId, record }`, sent right after validation when animation or
   review is still to run. The record is the one that will be stored minus animation and review results,
   and it has the same `cacheKey`. It is never stored. `item-ready` or `item-failed` for the same item
   always follows. Cache hits and items with nothing left to do send no preview.
3. **The pane** keeps previews in `PaneState.previews`, apart from `records`, so pin, feedback and
   history never touch an unstored record. A preview shows with its stage line ("Adding animation…",
   "Checking the result…") and no quality badge. `item-ready` replaces it, `item-failed` drops it, and
   `done` clears any left over.

## Consequences

- A critic repair can change the IR after the preview, so the pane swaps the visual on `item-ready`.
- Peak in-flight requests for one section can reach the global cap of 4 sooner. A second section
  generating at the same time queues behind it, as the limiter already allows.
- Tests: `packages/illus-pipeline/test/pipeline.test.ts` (parallel start, same-model serialization,
  preview order and contents), `apps/reader/src/illustrate/state.test.ts` and `PaneContent.test.tsx`.
