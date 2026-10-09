# 0010 — W3: context, concept pass and orchestrator decisions

- Status: proposed
- Date: 2026-10-09
- Workstream: W3
- Spec sections: §5, §6 phase B, §7, §8, §9, §15, §16

## Context

The spec leaves several details of the context packer, the concept pass and the section orchestrator open, and ADR 0008 (contracts v1.1) moved the IR compilers to `@illus/render`. These are the conservative choices W3 made; each can be changed without a contract change unless noted.

## Decision

**Compilers (§8 stage 3).** Per ADR 0008 decision 6 the IR → engine compilers live in `@illus/render` (W4); `@illus/core/compile` exports only `COMPILER_VERSION` (part of the visual key). `VisualRecord.spec` is `null` for every IR kind. Adding the constant changed the generated `docs/contracts.md` (one additive entry, regenerated with `pnpm contracts`).

**Prompt format (§7).** Besides the four tags of §7 the body uses `<previous_summary>`, `<concept_model>`, `<earlier_passages>` (lexical fallback), `<plan_item>`, `<template>` (template extractor), `<user_instruction>`, `<validator_report>` (retry), `<force>` ("illustrate anyway") and `<concept_models>` (planner, `conceptModels` flag on). Glossary entries are `<concept id name aliases spanning/>` so the planner can return real `conceptIds`. Only a `<` that could open a tag is escaped in book text, so code such as `lo <= hi` stays verbatim and quotable. Every W3 prompt lists all these book-text tags as data (rule 1).

**Gating and truncation (§7).** Reading-position gating also applies to the `referenced` slot: cross-references to later sections are left out. A definition is its block clipped to 150 tokens around the quote (no ±1 neighbouring paragraph). The default concept-model state is the model's earlier patches, until W8 passes `conceptModelState`. `dropped` lists every slot that lost an item to its cap or the budget. The lexical fallback queries with the sentence's content words (no noun-phrase parser).

**Concept pass (§6 phase B).** Sections without blocks get a local index (title as summary, `indexedWith.model = 'none'`) and no model call. A batch that fails with a non-limit error is retried once on the escalation tier, then skipped until the next `start()`. "Ambiguous clusters" are clusters that share a head noun (last word of the key) and are not all settled by an earlier merge; only these go to the `glossary` model. Earlier concepts are fed back as merges, so the model never re-decides them and concept ids stay stable. Canonical name: the merge's choice, else the most frequent defined surface form.

**Orchestrator (§15).**
- Flag-gated kinds (`template`, `trace`, `html`) are filtered when the plan is emitted, not in the cached plan, so turning a flag on later needs no re-plan.
- Cache lookups try every model of the role's route chain (primary first), because a fallback result is stored under the fallback model's key (§9).
- An L1 `schema` error from the client is treated like an unusable extraction: retried with the report, then escalated once. After that the item fails with its report; W3 does not call W10's `repair` role yet.
- Version bumps: a new prompt or compiler version is a cache miss and regenerates; showing the old record as `stale` with a "regenerate" hint is left to the pane and the cache lifecycle (not implemented here).
- Events beyond §15: `no-visual` and `error`. Cancelled jobs emit nothing but `done`; extractor calls already in flight still complete and are stored.
- Concurrency uses a small FIFO limiter (4 LLM requests, 2 sections, 2 items per section) instead of `p-queue`, which is approved but not needed for FIFO.
- Routes behind flags: `trace` (translator call + W7's `TraceRunner`; no trace-fixer or simulated fallback yet), concept models (W8 implements `ConceptModelRoute`, defined in `@illus/pipeline` because `@illus/core` has no port for it), `animate` (animator call + W6's validation hook; an invalid animation is dropped and the static visual kept), critic (an injected hook).
- "Illustrate selection" builds a synthetic section `<parentId>~sel-<hash>` whose plan and visuals are stored under that id.

**Fixtures.** Hand-written answers live in `packages/illus-pipeline/test/fixtures/synthetic-calls.ts`; `pnpm --filter @illus/pipeline fixtures:llm` replays the whole flow over `synthetic.epub` and writes `"source": "handwritten"` fixtures keyed by the exact prompts. Any change to the structural index, the packer, a W3 prompt version or the model config changes the keys; re-run the generator then.

## Consequences

- W1: the v1.2 code-block text change re-keys every fixture whose prompt contains code; after merging W1, run `pnpm --filter @illus/pipeline fixtures:llm` and commit the result.
- W4: owns the compilers and their parser tests; property tests over random IR and a Vega-Lite schema check are not in `@illus/render` yet.
- W6, W7, W8, W10: plug in through `PipelineDeps` (`validateAnimation`, `traceRunner`, `conceptModels`, `critic`).
- W9: subscribes to `SectionJob` events (Valtio store), passes the concept pass as `concepts`, W1's lexical index as `lexical`, and decides how to show stale records.
