# 0044 — W8 concept models: decisions, layout findings and requests to W3, W4 and W9

- Status: proposed
- Date: 2026-10-10
- Workstream: W8
- Spec sections: §5, §7 (slot 7), §13, §18 (G6)

## Context

W8 implements progressive concept models in `packages/illus-concepts/src/models`: `applyPatches()`, `generatePatch()` (catch-up, rebase, out-of-order insertion, re-validation), `createConceptModels().route` (the `ConceptModelRoute` W3 left in `@illus/pipeline`), section views, focus mode, interactive layout and `<EvolutionScrubber />`. Several points are not settled by the spec, and two need changes outside W8's paths.

## Decision

Conservative choices made by W8 (open questions for Shubham where marked):

1. **Gaps for a new model.** With no patch before S, every earlier section in `usedInSectionIds` is a gap. ≤ 3 → caught up first (the base patch is then the earliest section); > 3 → S gets a rebased patch. This is what makes out-of-order visits converge.
2. **Re-validation (§13 step 5).** An add of an existing id becomes an `update` of the fields that differ (label, sublabel, group), or is dropped when nothing differs. Different element type or different endpoints/parent → the patch is stale. Stale patches are skipped by `applyPatches()` and regenerated on their section's next visit. A gap section whose patch fails validation is stored stale with no ops, so it is retried when visited and not again during catch-up.
3. **Validation of a patch.** Each op is grounded (W10 `ground()`) against the current section's blocks plus the resolved cross-referenced blocks in the packed context; failing or non-applicable ops are dropped; one retry with a `<validator_report>`; no escalation. A patch with no surviving op fails the item (`ConceptModelError`).
4. **Model kind and id.** A new model's id is `makeConceptModelId(conceptId, planItem.kind)`; kind is read back from the id.
5. **State IR.** `StateIR.initial` is the first state added, `final` is `[]` (patch ops cannot set them). Graph direction defaults to `LR`.
6. **Annotations.** Persist in the state (slot 7 drops the oldest first); the section view shows only S's annotations, in `frame.annotations`.
7. **Focus mode** applies to `graph` models only; sequence and state models are not collapsed in v1.
8. **Layout stability.** `conceptLayoutGraph(model, layoutGraph)` passes stored positions (nodes and groups) as hints, which switches W4's layout to interactive mode. It tries four placements for new nodes (one layer after their furthest placed neighbour, stacked below or above everything, or beside the neighbour; plus W4's own neighbour hint) and keeps the one that moves existing nodes least. It shifts the result so stored nodes stay put on average (never below 0) and gives a model's first layout 48 px of room on the left and 96 px on top (tuned on the fixture), so later back-edge routes need not push it. If the layout engine rejects the hints it lays out from scratch.
9. **Displacement metric.** Measured with W4's merged `runElkLayout` (no test wrapper) on the 5-section fixture. Mean over every existing node's move between consecutive sections (the §18 eval metric): about 20 px. Per section change: 19.0, 45.3, 3.3 and 16.5 px. The 6.2 → 6.3 step adds a candidate node with two back edges into the `cluster` group, which ELK routes over the top. The test asserts the overall mean ≤ 40 px, 3 of 4 changes ≤ 40 px, and every change ≤ 100 px. **Open question for Shubham:** is the overall mean the intended reading, or must every section change be ≤ 40 px?

Requests to other workstreams (no edits made outside W8's paths):

- **W4 (resolved).** `runElkLayout` set the interactive strategies on the root only, so ELK threw `UnsupportedGraphException` for grouped graphs with hints. W4 fixed it on main (3be6446: interactive cycle breaking and layering, semi-interactive crossing minimisation and model order off on the root and every group, `elk.position` on hinted nodes). W8's test now uses the real `runElkLayout`.
- **W3 (wiring).** Pass `conceptModels: createConceptModels({ repos, llm, prompts, lexical }).route` in `createPipeline` deps (route uses the pipeline's limited `llm` argument). Optional: an `ItemStage` or event for "Catching up the concept model: N sections" (W8 exposes `onCatchUp`).
- **W9 (pane).** For a record whose plan item has `conceptModelId`/`newConceptModel` (`conceptModelIdOf(item)`), load the model and render `sectionView(model, section.ordinal, toggles)`: `<VisualView spec={{ ir: view.ir, newIds: view.newIds }} frame={view.frame} layoutGraph={conceptLayoutGraph(model, layoutGraph)} onLayout={(l) => repos.conceptModels.put(withLayout(model, l))} />`, without the record's cached layout. Show `<ConceptViewToggles />` and `<EvolutionScrubber Player={Player} renderView=… />`. Rendering from the model (not `VisualRecord.ir`) keeps later sections right after an out-of-order insertion.
- **W3 (package files).** W8 added react (peer) plus test devDependencies (`@illus/anim`, `@illus/llm`, `@illus/render`, elkjs, Testing Library, jsdom) to `packages/illus-concepts/package.json`, and the d3-hierarchy declaration to its `tsconfig.json` include (same as `@illus/anim`), all needed by `src/models`.

- **W0 (`docs/dependencies.md`).** List `@illus/concepts` as a user of the already-pinned `elkjs` 0.12.0, `jsdom` 30.1.1, `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `react`/`react-dom` 18.0.0 and `@types/react` 18.3.31 (dev/test only; `react` is a peer). No new package or version.

## Consequences

- `@illus/concepts` has `react` as a peer dependency. `<EvolutionScrubber>` takes W6's `Player` as a prop and is written without JSX, because `@illus/pipeline` (no `jsx` in its tsconfig) typechecks everything `@illus/concepts` exports; `@illus/anim` is only a devDependency (tests use the real player).
- Patcher fixtures (`fixtures/llm/patcher/`) are generated from `src/models/test/raft-book.ts` with `ILLUS_WRITE_FIXTURES=1 pnpm --filter @illus/concepts test`; regenerate after any context-packer or patcher prompt change.
