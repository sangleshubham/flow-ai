# 0058 — Concept pass on gpt-6-luna; book summary stays on gpt-6.1-sol

- Status: accepted (Shubham, 2026-10-17)
- Date: 2026-10-17
- Workstream: W2 (with W0 for the core roles table)
- Spec sections: §9
- Partly supersedes: 0046 (the `fast` tier and the indexer and glossary efforts)

## Context

ADR 0046 put every role on `gpt-6.1-sol`. Since then, ADR 0057 made a whole-book run finish the concept pass before planning anything. That makes the indexer, the highest-volume role, the gate for every whole-book run.

`gpt-6-luna` is the current small model in the GPT-6 family. It is not one of the older models that 0046 moved away from, and the spec's §9 mapping already puts it on the `fast` tier. Figures checked on 2026-10-17, from OpenAI's models page and third-party summaries (Artificial Analysis, Codex limit guides):

| Variant                 | Intelligence index | Output speed | First token | Output tokens for the index |
| ----------------------- | ------------------ | ------------ | ----------- | --------------------------- |
| gpt-6.1-sol low         | 42                 | 45 tok/s     | 2.75 s      | 9M                          |
| gpt-6.1-sol medium      | 48                 | 48 tok/s     | 3.9 s       | 15M                         |
| gpt-6-luna low          | 22                 | 119 tok/s    | 2.2 s       | 8.2M                        |
| gpt-6-luna medium       | 30                 | —            | —           | 29M                         |
| gpt-6-luna max (not v1) | 38                 | 120 tok/s    | 118 s       | 144M                        |

- API prices per million tokens: `gpt-6-luna` costs $0.10 input and $0.50 output; `gpt-6.1-sol` costs $2 and $10.
- Plus allows roughly 20 times as many Luna messages per five-hour window as `gpt-6.1-sol` messages (about 350–3,000 against 15–160, according to third-party estimates).
- `gpt-6-astra` was also considered and rejected: it costs five times as much as `gpt-6.1-sol`, runs slower, and scores only one point higher at max.

## Decision

- `DEFAULT_MODELS.tiers.fast` is `gpt-6-luna`, with no fallback. `standard` and `deep` stay on `gpt-6.1-sol`.
- `indexer` and `glossary` run on `fast` at **medium**. Luna at low scores 22, too far below `gpt-6.1-sol` at low (42) for concept extraction.
- A failed indexer batch still escalates once to `standard`, which means `gpt-6.1-sol` at high.
- `book-summary` moves from `fast` to `standard`, so its model and effort (`gpt-6.1-sol` at medium) don't change. It is one call per book, and it feeds every later prompt.
- Every other role keeps its ADR 0046 model and effort. The translator stays at high, because nothing escalates it: a failed trace goes to the trace-fixer and then to a fallback, and a translation that runs but is wrong is never caught. Lowering its effort would need a translator escalation path first.
- `ILLUS_MODELS_JSON` can still override any of these, for example `{"tiers": {..., "fast": [{"model": "gpt-6.1-sol"}]}}` to restore 0046.

## Consequences

- Indexer and glossary calls use a much smaller share of the Plus window, and their output arrives about 2.5 times as fast. Whole-book runs reach planning sooner.
- Concept quality may drop. Re-run `pnpm eval --live` on the concept pass (§9: "re-run the eval suite whenever a tier's primary model or a role's effort changes"). If it drops, raise both roles to `high` or revert the `fast` tier.
- Fixture keys include the model and effort, so `pnpm --filter @illus/pipeline fixtures:llm` regenerated the indexer and glossary replay fixtures. The book-summary fixtures are unchanged.
- Concept records indexed earlier keep `indexedWith.model: gpt-6.1-sol`. Nothing re-indexes them; the new model applies to sections indexed from now on.
