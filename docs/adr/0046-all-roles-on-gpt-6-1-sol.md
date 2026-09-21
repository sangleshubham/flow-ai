# 0046 — Every role on gpt-6.1-sol, effort set per role

- Status: accepted (Shubham, 2026-10-10)
- Date: 2026-10-10
- Workstream: W2 (with W0 for the core roles table)
- Spec sections: §9

## Context

The §9 default chains put the indexer, glossary and book-summary roles on the small `fast` tier (`gpt-6-luna`, `gpt-5.6-luna`). Escalation went to `gpt-6-astra`, and the `standard` tier fell back to older models (`gpt-6-sol`, `gpt-5.6-sol`, `gpt-5.6-terra`). Shubham asked to stop using the older, smaller models and run every task on `gpt-6.1-sol`, with a reasoning effort chosen for each task.

## Decision

`DEFAULT_MODELS.tiers` (`packages/illus-llm/src/models.ts`) has one entry per tier, all `gpt-6.1-sol`. The tier names stay; tiers now differ only by effort. There is no fallback model: if `gpt-6.1-sol` is unavailable, the call fails rather than dropping to an older model.

| Role                                            | Effort | Why                                                                        |
| ----------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| indexer                                         | low    | bulk background pass over the whole book; a bigger model needs less effort |
| glossary                                        | low    | merging names that are already extracted                                   |
| book-summary                                    | medium | one call per book, and it feeds every later prompt                         |
| planner                                         | medium | on the critical path of every section                                      |
| extractor.graph / mermaid / template / timeline | medium | quote-grounded structure                                                   |
| extractor.chart / math                          | low    | small, mostly literal                                                      |
| animator                                        | medium | ordered steps over known targets                                           |
| translator                                      | high   | code translation must be exact                                             |
| trace-fixer, patcher, repair, html-fallback     | medium |                                                                            |
| critic                                          | low    | a checklist over a rendered image                                          |
| any escalated call (deep tier)                  | high   |                                                                            |

`escalationEffort.default` becomes `high`. The `@illus/core` `ROLES` table and `escalationEffort()` match these values. The allowlist is unchanged, so `ILLUS_MODELS_JSON` overrides can still name other models. One example is the documented critic fallback to `gpt-6-astra` if `gpt-6.1-sol` rejects images.

## Consequences

- Fixture and cache keys include the model, so the indexer, glossary and book-summary replay fixtures were regenerated with `pnpm --filter @illus/pipeline fixtures:llm`. Cached plans keep their keys, because the planner stays on `gpt-6.1-sol` at medium.
- The gateway's fallback logic is unchanged. Its tests now use an explicit multi-model chain.
- Background indexing costs more per call, but it runs at low effort. Each call counts once against the local request caps, as before.
