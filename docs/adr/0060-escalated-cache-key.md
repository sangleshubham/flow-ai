# 0060 — Escalated visuals keep the requested-route cache key; cached sections skip the index wait

- Status: proposed
- Date: 2026-10-21
- Workstream: W3
- Spec sections: §5 (cache keys), §9 (W2 rules), §15 steps 2 and 4

## Context

The user reported that illustration caching "is not working well". Two causes in `packages/illus-pipeline/src/pipeline.ts`:

1. **Escalated visuals never hit the cache.** A visual lookup computes keys from `expectedRuns(role)`, the role's non-escalated chain (for extractors `gpt-6.1-sol` at `medium`). After a retry fails and the extractor escalates, the record was stored under the key of the run that answered: the deep tier (`gpt-6.1-sol` at `high`). No later lookup computes that key, so every revisit paid again for extract, retry and escalate. §9 says "Record the model and effort actually used in `VisualRecord.models`; both are part of the cache key, so a fallback result never overwrites a primary-model result". That rule is about fallback models, but the code applied it to escalation too, which makes the key impossible to predict.
2. **Cached sections waited for the concept index.** `runJob` waited up to 20 s (`INDEX_WAIT_MS`) on `indexNow` for any section without a section index, before checking the plan cache. When the concept pass was paused (for example by a usage limit), opening a section that was already fully illustrated took 20 s.

The planner, translator and trace-fixer are not affected by the first cause. The pipeline never escalates the planner or translator. A fallback model (non-escalated) is still in the lookup chain, and trace-fixer repairs do not enter the trace key, which uses the translator run.

## Decision

1. **One canonical key: the requested route.** A visual is stored under the key of the run that answered its non-escalated attempts (`extractor.model` and `extractor.effort` in the §5 visual key), even when the escalated attempt produced the IR. If no non-escalated attempt returned a response (both failed the schema), the key uses the route's primary run. The run that produced the IR stays in `VisualRecord.models[role]` (for example `gpt-6.1-sol@high`), and `validation.escalated` is `true`. Fallback behaviour is unchanged: a fallback model's non-escalated result is keyed by that fallback model, as §9 requires.
2. **Old records stay readable, with no migration.** Visual lookups try the expected runs first, then the role's escalated runs (`resolveRoute(models, role, true)`, skipped for roles with no escalation tier). Records that builds before this ADR stored under escalated keys are still hits. Nothing is rewritten, so there is no migration and nothing to roll back. A canonical-key record always wins over a legacy one.
3. **The index wait happens only before a model call that packs context.** The plan cache is checked first. `indexNow` is awaited (up to 20 s, at most once per job, shared by its items) only before planning, or before an item that missed the visual cache packs its extractor, translator or patcher context. A section whose plan and visuals are cached is served at once and does not call `indexNow`.

`@illus/core` (cache-keys, schemas) is unchanged. `visualKey` keeps the same inputs; only what the pipeline passes as `extractor` changes for escalated results.

## Consequences

- Revisiting an item that was produced through escalation is a cache hit with no model calls.
- If only the escalation tier or escalation effort changes in `ILLUS_MODELS_JSON`, escalated visuals are still served from the cache. The base route's model, effort or prompt version still invalidates them, as for any visual. Exception: records stored before this ADR under an escalated key are matched through the escalation route, so a change to the base route's model or effort alone does not invalidate them; a prompt-version or escalation-tier change does. This is intended: the key describes the request, and the record shows what answered it.
- A lookup that misses makes up to one extra `visuals.get` per escalated-chain model. This is an in-process IndexedDB read and costs nothing in plan usage.
- When the plan is cached but an item's visual is not, that item shows `queued` while the index wait runs, instead of the job waiting before the `plan` event.
- §5 and §9 read as before for non-escalated results. This ADR narrows "the model and effort actually used are part of the cache key" to non-escalated attempts.
- Tests: `packages/illus-pipeline/test/pipeline.test.ts` covers an escalate-then-revisit hit with no calls, a legacy escalated-key record that is still found, and a cached-plan section with no section index that resolves without the 20 s wait (fake timers), plus the lazy wait on a visual miss.
