# 0043 — W8 concept models: decisions, layout findings and requests to W3, W4 and W9

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
8. **Layout stability.** `conceptLayoutGraph(model, layoutGraph)` passes stored positions as hints, hints new nodes one layer after their furthest placed neighbour (two placements tried, the one that moves existing nodes least wins), shifts the result so stored nodes stay put on average (never below 0), and gives a model's first layout 64 px of headroom. If W4's layout rejects the hints it lays out from scratch.
9. **Displacement metric.** Tested as the §18 eval metric: the mean over every existing node's move between consecutive sections (pooled over the 5-section fixture): about 34 px. Per transition: 35, 81, 3 and 27 px. The 6.2 → 6.3 step adds a candidate node with two back edges into the `cluster` group; ELK routes them over the top and re-aligns the third layer. **Open question:** is the pooled mean the intended reading, or must every transition be ≤ 40 px?

Requests to other workstreams (no edits made outside W8's paths):

- **W4 (bug, blocks hinted layouts with groups).** `runElkLayout` sets the INTERACTIVE cycle-breaking, layering and crossing-minimisation strategies on the root only. With groups (`INCLUDE_CHILDREN`), ELK throws `UnsupportedGraphException: The hierarchy aware processor LAYER_SWEEP in child node … is only allowed if the root node specifies the same hierarchical processor`. Fix: copy those three options into the `layoutOptions` of every compound node when hints are present. W8's test applies exactly this through an ELK proxy (`interactiveCompounds` in `src/models/test/view.test.ts`); until W4 ships it, grouped concept models fall back to unhinted layouts in the app.
- **W3 (wiring).** Pass `conceptModels: createConceptModels({ repos, llm, prompts, lexical }).route` in `createPipeline` deps (route uses the pipeline's limited `llm` argument). Optional: an `ItemStage` or event for "Catching up the concept model: N sections" (W8 exposes `onCatchUp`).
- **W9 (pane).** For a record whose plan item has `conceptModelId`/`newConceptModel` (`conceptModelIdOf(item)`), load the model and render `sectionView(model, section.ordinal, toggles)`: `<VisualView spec={{ ir: view.ir, newIds: view.newIds }} frame={view.frame} layoutGraph={conceptLayoutGraph(model, layoutGraph)} onLayout={(l) => repos.conceptModels.put(withLayout(model, l))} />`, without the record's cached layout. Show `<ConceptViewToggles />` and `<EvolutionScrubber Player={Player} renderView=… />`. Rendering from the model (not `VisualRecord.ir`) keeps later sections right after an out-of-order insertion.
- **W3 (package files).** W8 added react (peer) plus test devDependencies (`@illus/anim`, `@illus/llm`, `@illus/render`, elkjs, Testing Library, jsdom) to `packages/illus-concepts/package.json`, and the d3-hierarchy declaration to its `tsconfig.json` include (same as `@illus/anim`), all needed by `src/models`.

- **W0 (`docs/dependencies.md`).** List `@illus/concepts` as a user of the already-pinned `elkjs` 0.12.0, `jsdom` 30.1.1, `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `react`/`react-dom` 18.0.0 and `@types/react` 18.3.31 (dev/test only; `react` is a peer). No new package or version.

## Consequences

- `@illus/concepts` has `react` as a peer dependency. `<EvolutionScrubber>` takes W6's `Player` as a prop and is written without JSX, because `@illus/pipeline` (no `jsx` in its tsconfig) typechecks everything `@illus/concepts` exports; `@illus/anim` is only a devDependency (tests use the real player).
- Patcher fixtures (`fixtures/llm/patcher/`) are generated from `src/models/test/raft-book.ts` with `ILLUS_WRITE_FIXTURES=1 pnpm --filter @illus/concepts test`; regenerate after any context-packer or patcher prompt change.
