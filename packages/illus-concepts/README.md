# @illus/concepts

Browser compatibility: array-valued repository results are awaited into locals before calls such as `Map.set`. This preserves empty and multi-block section arrays under Next 12's async compiler (ADR 0037).

Concept pass (indexer batches, glossary merge, book summary), concept registry, and (in `src/models`, W8) progressive concept models.

- Owner: W3 (W8 owns `src/models`)
- Spec: §6 phase B, §13

## Public API

- `createConceptPass({ bookId, repos, llm, ground?, now?, glossaryEvery?, onProgress? }): ConceptPass`
  - `start()`: runs until every section has a `SectionIndex`, `pause()` is called, or a plan limit stops it (the result then carries `error`). Resumable: progress is the stored index records; a finished book makes no calls.
  - `pause()`: aborts the in-flight call (book closed).
  - `setOpenSection(id)`: re-prioritise (open section, then ±10 ordinals, then the rest).
  - `indexNow(id)`: jumps the queue; resolves `true` once indexed, `false` if the pass stopped first.
  - Batches: up to 8 sections or 8,000 tokens per `indexer` call. Sections without blocks get a local index (title as summary, no model call).
  - Every `defines[].evidence` is grounded with `ground()` (W10); failed definitions are dropped.
  - A batch that fails with `schema`/`upstream`/`timeout` is retried once on the escalation tier, then skipped for this run.
  - Glossary merge after every 50 newly indexed sections and at completion; book summary once 30% are indexed (if none yet) and again at completion. Then `books.indexStatus = 'complete'`.
- Deterministic clustering: `nameKey` (lowercase, punctuation stripped, last word singularised), `acronymPairs` ("Long Name (LN)"), `clusterConcepts`, `ambiguousGroups` (clusters sharing a head noun, at least one not yet settled by a merge; only these go to the `glossary` model), `toConcepts` (`firstOrdinal`, `definedInSectionId`, `usedInSectionIds`, `spanning` when used in ≥ 3 sections; existing concepts keep their ids).
- Scheduling: `prioritize`, `takeBatch`, `planBatches`, and `estimateIndexUsage(pending, { indexConfirmThresholdTokens, maxRequests5h })` for the pre-index confirmation (§6 phase B step 8).
- `bookContext(book)`: the `<book_context>` prefix of the indexer, glossary and summary calls.

## Example

```ts
import { createConceptPass, estimateIndexUsage } from '@illus/concepts'

const est = estimateIndexUsage(pending, { indexConfirmThresholdTokens: 300_000, maxRequests5h: 100 })
if (!est.needsConfirm || (await askReader(est))) {
  const pass = createConceptPass({ bookId, repos, llm, onProgress: (p) => showProgress(p.indexed, p.total) })
  pass.setOpenSection(currentSectionId)
  void pass.start()
}
```

## Concept models (`src/models`, W8, §13, flag `conceptModels`)

- `applyPatches(model, uptoOrdinal?)` → `{ state, patches }`: pure, in order, typed per kind (`graph`, `sequence`, `state`); stale patches skipped; each patch reports `added`, `updated`, `removed` (with cascades) and `annotated`. Also `applyOps`, `toIR`, `compactState`, and `conceptModelState` (the `PackInput.conceptModelState` for slot 7).
- `createConceptModels({ repos, llm, prompts?, ground?, lexical?, onCatchUp? })`:
  - `generatePatch(sectionId, conceptModelId, { planItem?, signal? })`: §13 steps 1–6. Reuses a non-stale patch; catches up ≤ 3 gap sections (`onCatchUp`), otherwise one `rebased: true` patch with `<gap_summaries>`; grounds and applies every op (dropping failures, one retry with a validator report); inserts out of order and re-validates later patches (add of an existing id → update or nothing; still failing → `stale`). Serialised per model.
  - `route`: the `ConceptModelRoute` of `@illus/pipeline`; returns the model at S as `ir`.
  - `checkPatch`, `revalidateAfter`, `insertPatch`, `parseConceptModelId`, `conceptModelIdOf`.
- Views: `sectionView(model, ordinal, { onlyNew?, fullModel?, title?, direction? })` → `{ ir, newIds, removedIds, frame, patch, focus, collapsed }`; removed elements stay in `ir` and in `frame.removed` to fade out; focus mode past 24 graph nodes (`focusGraph`).
- Layout: `conceptLayoutGraph(model, layoutGraph)` (hints from `model.layout`, INTERACTIVE ELK), `withLayout(model, layoutResult)`, `meanDisplacement(prev, next)`.
- React (no JSX, so DOM-free importers stay JSX-free): `<EvolutionScrubber Player model sectionOrdinal renderView sectionTitles? viewOptions? />` (pass W6's `Player`; one frame per patch), `<ConceptViewToggles value onChange />`, `evolutionFrames()`.
- Prompt: `docs/prompts/patcher.md`; fixtures: `fixtures/llm/patcher/` (`ILLUS_WRITE_FIXTURES=1 pnpm test` regenerates them from `src/models/test/raft-book.ts`). Decisions and open questions: ADR 0043.

```tsx
const cm = createConceptModels({ repos, llm, prompts })
createPipeline({ ...deps, conceptModels: cm.route })
// pane
const view = sectionView(model, section.ordinal, toggles)
<VisualView spec={{ ir: view.ir, newIds: view.newIds }} frame={view.frame}
  layoutGraph={conceptLayoutGraph(model, layoutGraph)} onLayout={(l) => repos.conceptModels.put(withLayout(model, l))} theme={theme} />
```

## Scripts

- `pnpm lint` · `pnpm typecheck` · `pnpm test`
