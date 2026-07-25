# 0003 — Contract decisions in @illus/core v1.0

- Status: proposed (part of the contracts v1.0 review)
- Date: 2026-10-09
- Workstream: W0
- Spec sections: §5, §9, §11, §12, §13, §16

## Context

§5 leaves some types open (`ClassIR`, `ErIR`, `ValidationReport`, store records) and shows others in a form that strict structured outputs (`text.format` json_schema, strict, §9) cannot express. W0 had to choose. Everything below is visible in `docs/contracts.md`.

## Decision

**Changes to spec shapes (for structured outputs)**

1. Model outputs that are arrays get an object root: `indexer` → `IndexerOutput { sections: SectionIndexOutput[] }` (≤ 8), `glossary` → `GlossaryOutput { merges: ConceptMerge[] }`, `patcher` → `PatchOutput { ops: PatchOp[] }` (1–8). The client adds the non-model fields: `indexedWith` → `SectionIndex`; `patchId`, `sectionId`, `sectionOrdinal`, `createdWith` → `Patch`.
2. `TemplateIR.evidence` is `{ path, evidence }[]` instead of `Record<string, Evidence>`; strict mode cannot express open maps. Same meaning.
3. `LlmRequest` gains optional `templateId`, required when `schemaName` is `TemplateIR`, so the gateway can validate `props` with that template's own schema. `LlmResponse` (ok) gains `effort`, the effort actually sent, needed for `VisualRecord.models` and cache keys (§9).
4. `PatchOp`'s `item: unknown` add-ops are typed per kind (`SequenceParticipant`, `SequenceMessage`, `StateNode`, `StateTransition`).

**Open shapes filled in**

5. `ClassIR`: classes (stereotype, ≤ 8 fields, ≤ 8 methods, each with evidence) and relations (6 UML kinds, cardinalities from `1 | 0..1 | 0..* | 1..* | * | n`). `ErIR`: entities (≤ 12 attributes with optional PK/FK/UK) and relationships with crow's-foot cardinalities, a required label and `identifying`. Size limits mirror graph: ≤ 12 classes or entities, ≤ 18 relations. These limits are W0's conservative choice and are tunable after the M2 eval.
6. `ValidationReport`: `ok`, `groundingScore` (§16 formula), element counts, dropped ids, typed `issues` (layer, severity, code, message, elementId, autoFixed), `retried`, `escalated`.
7. `FrameState` (§11) for renderers: `hidden`, `removed`, `highlights` (target → tone), `pointers`, `values`, `slots` (element → slot after swaps), `containers` (push/pop contents), `added`, `annotations`, `tokens` (both current step only), `focus`, `relayout`. Marked as a draft that W6 may amend through the normal process.
8. Store records not spelled out in §5: `BookMeta` (`books`), `SectionIndexRecord` (adds `bookId`), `PlanRecord` (adds `partialContext`, §15), `TraceRecord` (translation plus labelled scenario traces, `executed | simulated`), `LlmLogEntry`, `SettingRecord`.
9. Additions to spec types: `SectionNode.mergedInto` (§6 step 12, §15 step 1); `Evidence.fuzzy` (§16 step 4); `Patch.rebased` and `Patch.stale` (§13); `VisualRecord.pinned`, `layout`, `instruction`, `elementReports` (§10, §15, §16). `AnimationIR` follows §11 (with `initialHidden`), not the shorter §5 copy.
10. Ids: `IrId` slug `^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$` for model-made element ids (Mermaid-safe); `makeConceptId` = `${bookId}:c:${slug}` and `makeConceptModelId` = `${conceptId}:m:${kind}` are W0 conventions the spec does not define. `contentHash` joins block texts with `\n`.
11. Cache keys hash `JSON.stringify` of the spec's part list, with `undefined` → `null`. `visualKey` appends the "regenerate with instruction" text only when present, so a regenerated result is a new record (§8). `CONTEXT_VERSION`, `COMPILER_VERSION`, `TRACER_VERSION` and `INDEX_VERSION` are owned and exported by the packages that bump them (W3, W3, W7, W1) and passed in.
12. Schema-level rules beyond limits: `VisualPlan` has items exactly when `needsVisual`, with unique `planItemId`s; `PlanItem` requires `templateId` for templates and `codeBlockId` for traces, and allows concept models only for graph, sequence and state; `ChartSeries` has `fn` xor `points`; `ConceptModel.patches` are sorted; a `code` block carries `code`.
13. Feature flags all default to `false` until their workstream's "done when" passes.

## Consequences

- **W2 (gateway)** still has to adapt Zod JSON Schema to OpenAI strict mode: optional properties must become required-and-nullable (with nulls stripped before the Zod parse); `ChartIR` tuples (`prefixItems`) and `TemplateIR.props` (composed per template) need checking at M0. If strict mode rejects tuples, request a contract change for `ChartIR`.
- Prompts (W3, W6, W7, W8) must describe the wrapper objects above.
- Contract changes after approval go through an ADR plus `amend contracts` (version bump, regenerated `docs/contracts.md`).
