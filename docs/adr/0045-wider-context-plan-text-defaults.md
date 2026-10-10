# 0045 — Wider context, plan text and on-by-default visuals

- Status: accepted (decided by Shubham, 2026-10-10)
- Date: 2026-10-10
- Workstream: W3 (with W0, W2, W6, W9; see `tasks.md` T1–T8)
- Spec sections: §4 (feature flags), §5, §7, §8, §9

## Context

Live use showed four problems (`tasks.md`, "Why"):

- Visuals were basic and never animated. Every flag defaulted to `false`, so `template:*` items and all animations were dropped after planning.
- The planner saw only the open section. A chapter intro such as "Replication" got one box, while its subsections described single-leader, multi-leader and leaderless replication. §7 has no slot for the open section's subsections, and §8 rule 6 plus "use only the provided text" kept the model from using them.
- The pane showed only the ≤ 25-word `intent` and a one-line `reason`.
- Sections got stuck. A Responses stream that stalled after its headers could hang forever, because the SDK timeout stops once the headers arrive.

## Decision

1. **Same-chapter descendants are context and evidence (changes §7 and §8).** `packContext` gets a `subsections` slot right after `current`. It holds the descendants of the open section in ordinal order, as `<subsections><subsection title="…" depth="n">` with `<block id>`s. Each descendant is clipped to 600 tokens, the slot is capped at 4,000 tokens, and a titles-only outline comes first so the cap drops text before structure. Synthetic sections have no such slot. The block ids join `usedBlockIds`, so their quotes are valid evidence. Siblings, ancestors and later chapters stay excluded, and reading-position gating is unchanged. `CONTEXT_VERSION` becomes 2.
2. **Prompts.** `planner` 1.1.0 and every `extractor.*` 1.1.0 treat `<subsections>` as data and quotable evidence. Rule 6 still forbids later-chapter concepts. The planner plans only kinds in `<available_kinds>`, and it plans a comparison (`template` `comparison`, else a `graph` `TB` taxonomy) when a section or its subsections present several variants of one idea. One kind-table row is appended after the §8 table, which stays verbatim.
3. **Plan text (changes §5).** `VisualPlan.overview` (≤ 120 words) and `PlanItem.caption` (≤ 60 words) are both optional, so older cached plans still parse. The pane shows the overview above the tabs and the active item's caption above its visual.
4. **Flag defaults (changes §4).** `templates` and `animations` default to `true`. The other flags stay `false`. `planKey` takes an optional `kinds` list of the enabled flag-gated kinds, so toggling a flag re-plans; when `kinds` is absent, the key is unchanged.
5. **Stream idle timeout (§9).** The OpenAI provider aborts a Responses stream that sends no event for 180 s (`STREAM_IDLE_MS`; reasoning streams no events, so it is not tighter than the per-attempt timeout) and throws `ProviderError('timeout')`. The gateway's existing retry policy handles it.
7. **Cancellation aborts every call (changes §15, which let in-flight extractor/animator/translator/patcher calls finish and be cached).** Every pipeline call gets the job's abort signal, and a cancelled job starts no further step (retry, escalate, animate, repair, review). Finishing abandoned calls held the 2 section slots and 4 request slots, so newly opened sections queued behind work the reader had left; that was the main cause of sections stuck on "Reading this section…". The cost: an aborted call's plan allowance is spent without a cached result.
6. **Earlier book context.** `SUMMARY_AT = 0.1` and `GLOSSARY_EVERY = 15` (were 0.3 and 50), so the book summary and glossary arrive sooner.

## Consequences

- Prompt versions and context v2 change every planner and extractor cache key and LLM fixture key. Cached plans and visuals turn `stale`, and the replay fixtures are regenerated (T8).
- Elements grounded in a subsection are outside the current section, so they render in the muted "from earlier" style. That style also covers "elsewhere in this chapter".
- Saved user preferences keep their old `false` flag values. Shubham turns Templates and Animations on once in Illustrate settings.
- The `docs/prompts` example limit (exactly two) still holds. In the planner, the Replication example replaces the earlier leader/follower sequence+state example.
- Contracts touched: `@illus/core` plan schema, `planKey`, `DEFAULT_FLAGS` (T2), `@illus/context` slots (T4), `@illus/llm` provider (T1). `docs/contracts.md` records them.
