# 0065 — Show stale visuals as a fallback until the section is regenerated

- Status: proposed
- Date: 2026-10-21
- Workstream: W9, W3
- Spec sections: §5 (cache keys), §14 (offline), §15 steps 3 and 4; amends ADR 0064 decisions 1 and 2

## Context

ADR 0064 made `Pipeline.cachedSection` and the reader's `showCached` return only records under current keys. That fixed overstated counts and skipped dwells. But after a prompt-version, model-route or flag change, a section now shows nothing, even offline, until it is regenerated. Shubham already reports that "caching is not working well", and a blank pane over a section he has illustrated before reads as lost work.

`VisualRecord.stale` exists in the schema, and `RecordView` already says "This saved illustration is from an earlier version. Regenerate to update it." for a record with `stale: true`. Nothing sets it. Plan item ids such as `p1` are assigned per plan, so a newer planner version can reuse `p1` for a different intent. A visual from an older plan must therefore never be shown under a newer plan's item.

ADR 0064's review also left two follow-ups in `prepareLater` (`apps/reader/src/illustrate/runtime.ts`). Toggling `wholeBook` while a preparation was in flight started a second `prepareBookRun`. A failed cache check there put the whole pane into `error`, which hid a working section pane.

## Decision

1. **The pipeline returns the fallback on request.** `cachedSection(sectionId, { stale: true })` adds `stale: { plan, records }` (`StaleFallback`, exported from `@illus/pipeline`). `status` is unchanged, so `sectionCacheStatus`, `markCached`, `cachedCount`, the "done" count and `BookRunState.sections` never count a fallback. Without the option the result is the same as in ADR 0064.
   - `missing` (no current plan): the newest of the section's stored plans by `createdAt`. If it has nothing to draw, there is no fallback; an even older plan is never used. Its enabled items are used, and nothing from the current flags' other plans is mixed in.
   - `partial` (current plan, some visuals missing, for example after an extractor version change): only the plan's enabled items with no current-key visual fall back. A current plan never gets another plan's visuals.
   - `cached` and `no-visual`: no fallback.
   - **Which plan a visual belongs to.** A visual belongs to the newest of its section's plans created at or before it (`createdAt`). Per item, the newest such visual of the chosen plan is used. A visual made before the plan, or after a later plan of the section, is left out. Visual keys cannot be recomputed for older prompt versions, so this time rule is the only link between a record and its plan.
   - The records are copies with `stale: true`. Storage is never written.
   - A failing read made only for the fallback (`sections.get` and both list reads for `missing`, `plans.listBySection` for `partial`) loses only the fallback: the current records are still returned, so a partial section never goes blank.
2. **The reader shows the fallback and still regenerates.** `showCached` shows current records first. For each item with no current record, it shows the fallback record if its IR still parses (`parsedVisual`; trace records point at a stored trace and are kept). With no current plan, `pane.items` is the stale plan's items that have a visual, so no tab shows another item's visual. `showCached` returns true only for `cached` or `no-visual`, so a section with a fallback still waits for the dwell and is regenerated when the reader stays on it or the whole-book run reaches it. Offline, the fallback is shown with the existing offline message. While the dwell, planning or generating states are shown, `PaneContent` shows those states instead of the visual, as before. This ADR does not change `PaneContent`.
3. **Fresh results replace the fallback without mislabelling it** (`bindJob` in `state.ts`).
   - `plan`: a stale record stays only if the fresh plan has an item with the same id, intent and kind as the item it was shown under. Otherwise it is dropped, because the id was reused or the item changed. Current records are left alone, as before.
   - `item-ready` replaces the item's record, stale or not, as before.
   - `item-failed`: the item's stale record is dropped, so a failed regeneration never leaves an older visual standing in for the new item. Exception: `plan-limit` and `signin-required`. These codes block every request rather than fail the item, and the record already matched the item at `plan`. So the stale visual stays visible in the blocked state, like any cached visual.
4. **Stale is never persisted.** `updateRecord` (pin, layout, feedback and element reports) stores the record with `stale: false` and keeps the in-memory copy's `stale: true`. Pinning a fallback therefore pins the stored record without marking it stale. The pipeline never writes `stale: true` either, so `illus-store`'s eviction order ("oldest stale first") is unchanged.
5. **`parsedVisual` never throws.** It wraps `IR.safeParse` and turns a thrown error into a failed parse. A stale record that fails is skipped. A current record that fails still shows the existing "cannot be displayed" message.
6. **One preparation at a time; its failure is the bar's.** `prepareOnce(own)` shares one in-flight `prepareBookRun` per book setup between `activate` and `prepareLater`. If `prepareLater` fails, only `bookRun` goes to `error` with the message; `pane.status` is untouched. The bar's Retry (`retryActivate`) then runs the preparation again without setting the book up again. A failure inside `activate` still uses the ADR 0064 path (`activationFailed`, then Retry runs `activate`).

`@illus/core` is unchanged. No IndexedDB schema or stored-record change, so there is no migration. Rollback is a revert: builds before this ADR ignore the option and never see a stored `stale: true`. The dry-run requirement does not apply because nothing is migrated.

## Consequences

- After a prompt, model or flag change, previously illustrated sections show their older visuals with the "earlier version" note: offline, before indexing is approved, when blocked by the plan limit or sign-in, and next to regenerated items. They are regenerated as before and replaced as each item arrives.
- Counts, the run's cache check and dwell decisions are exactly as in ADR 0064.
- `cachedSection(…, { stale: true })` reads `plans.listBySection` for `missing` and `partial` sections, plus `sections.get` for `missing`. These are local IndexedDB reads with no model calls.
- Known limit of the time rule: if the reader goes back to an older flag set and regenerates one of its items, that visual is newer than a plan made under the other flag set. It is then attributed to the newer plan. Until the section is regenerated it can then be shown under that plan's item with the same id, possibly a different intent; this needs a flag set to be revisited and regenerated, and is accepted for v1. Equal `createdAt` values are treated as "at or after".
- While the pane shows `waiting`, `planning` or `generating`, the fallback is not visible (`PaneContent` shows those states). Showing it under the dwell card is a possible follow-up for the panel owner.
- Tests: `packages/illus-pipeline/test/pipeline.test.ts` (`stale fallback (ADR 0065)`), `apps/reader/src/illustrate/state.test.ts` (`stale fallback (ADR 0065)`), `apps/reader/src/illustrate/runtime.test.ts` (`stale fallback (ADR 0065)`, `prepareLater`) and `apps/reader/src/illustrate/RecordView.test.tsx` (badge).
