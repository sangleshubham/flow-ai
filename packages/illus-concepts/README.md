# @illus/concepts

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

## Scripts

- `pnpm lint` · `pnpm typecheck` · `pnpm test`
