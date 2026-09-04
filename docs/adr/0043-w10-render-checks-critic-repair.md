# 0043 — Render checks, critic, repair loop, feedback export and live eval (W10 phase B)

- Status: proposed
- Date: 2026-10-10
- Workstream: W10
- Spec sections: §8 stage 3, §9 (critic, repair, effort sweep), §16 L3–L6, §18

## Context

§16 fixes the layers but leaves the wiring open: where L4 and L5 run (they need a browser), what the critic sees, how a repaired IR is accepted, how feedback leaves IndexedDB, and how `pnpm eval --live` reaches the plan without a running reader. Where the spec was unclear the conservative option was taken.

## Decision

**L4 render checks (`@illus/render`, `src/check`)**

1. Findings are `render`-layer **warnings** (`label-overlap`, `text-overflow`, `aspect-ratio`, `edge-crossings`): the visual is always shown; they drive re-layout and repair, and remaining ones stay on `validation.issues`.
2. Measurement is in screen pixels relative to the SVG: label box = union of an element's own `text`/`foreignObject`; shape = its largest `.illus-shape`/`rect`/`polygon`/`ellipse`/`circle` (nodes only); edges = the `.illus-edge-line` (or first `path`) of `edge:` targets, sampled every 6 px. Meetings within 4 px of an edge's end are not crossings. Text overflow checks width only. Sequence messages are not crossing-checked.
3. The deterministic retry flips `LR`↔`TB` for graphs only (the only IR with a direction) and keeps the flip only when it removes the aspect-ratio finding.

**L5 critic (`@illus/core` `critique`, `@illus/render` `renderForReview`)**

4. The critic gets the PNG, the plan item's intent and `summarizeIr(ir)` = the IR JSON with every `evidence` removed, so no book text. `pass` is recomputed with `criticPasses`; the model's own `pass` is ignored.
5. "900 px width, 2×": the SVG at its natural size, capped at 900 CSS px, rendered at 2× density (so at most 1800 px wide). Small diagrams are not blown up.
6. Math (KaTeX HTML), HTML fallback and trace visuals are not reviewed (no SVG, or no IR).

**Repair (`@illus/core` `repairIr`, `reviewVisual`)**

7. One `repair` attempt per layer: L4 (findings left after re-layout) and L5 (critic issues, then the critic judges again). The repair sees the extractor's packed context; its answer is re-validated against the same permitted blocks and adopted only when `report.ok` and not `needsReextract`. Otherwise the original IR is kept with a `repair-rejected` warning. A visual still failing the critic is kept with its report (the pane's warning badge).
8. `plan-limit` and `aborted` stop the review; every other model error becomes a warning (`critic-failed`, `repair-failed`) and the visual is kept.
9. The `repair` and `critic` prompts tell the model that a block's `alt` attribute is information, never quotable evidence (ADR 0025).

**Feedback export (§16 L6)**

10. Input is the reader's existing cache export (W2's `illus-cache` file), so no new UI is needed. Each thumbs-down or "This is wrong" report becomes one regression case: `needsVisual: true`, acceptable kinds = the planned kind, `mustNotInclude` = the labels of elements reported wrong, the reader's notes in `notes`. Cases from books outside the repository go to the git-ignored `evals/regressions/private/`. Existing case files are never overwritten (they may have been curated).

**Evals**

11. `pnpm eval` runs through Vite's SSR loader (`evals/bin/run.mjs`), because the eval imports TSX templates and Flow's epub.js. Template IRs are now checked against W5's registry in scoring, and validation errors fail a case.
12. `pnpm eval --live` runs the real pipeline in Node with the `@illus/llm/server` gateway **in-process**, configured from the reader's `.env.local` (same token store, caps and usage file). The gateway is rebuilt per effort override, so the §9 sweep needs no restarts. Node has no Pyodide worker and no renderer, so live runs mark trace and critic as `unsupported` (not failed); those are measured in the reader. Recordings (`--record`) of private books go to `evals/replay/private/`.
13. The golden set has the §18 shape (8/6/4/8/8/2/4). 16 cases use open books with replays (3 new ones recorded by the live runner in replay mode over W3's hand-written fixtures); 24 are private placeholders (`sectionId: "fill-in"`) that replay skips.

## Contract-change requests

- **W3 (`@illus/pipeline`)**: the `critic` hook returns only a `CriticReport`, so a repaired IR or the render findings cannot come back, and the hook lacks the packed context `repair` needs. Proposed: `review?: (record, ctx: { context: LlmContext; validation: ValidationContext; planItem: PlanItem; signal: AbortSignal }) => Promise<VisualRecord>`, called where `critic` is called today, with `reviewVisual(record, { ...env, intent: planItem.intent, repair: ctx })`. Until then `criticHook(env)` gives L4 + L5 without repair. Also: §16 L3 says "else `repair` once"; today a non-ok report after escalation fails the item (accepted in ADR 0010). `repairIr` is ready if Shubham wants L3 repair.
- **W9 (`apps/reader`)**: pass `critic: criticHook({ llm, theme, templates: templateRegistry, intent })` to `createPipeline` (the pipeline already gates it on the `critic` flag), with `intent` read from the plan record; show the warning badge when `record.critic.pass` is false.
- **W4 (`@illus/render` package.json)**: add `"e2e:check": "playwright test -c src/check/e2e"` to the `e2e` chain. W10 added one export line to `src/index.ts` (`export * from './check/index.ts'`).
- **W0**: allow `@illus/render/templates` in the no-deep-imports lint rule (it is a published entry, ADR 0040; evals use a scoped disable today); record in `docs/dependencies.md` that `@illus/evals` uses `vite` 8.3.1, `jsdom` 30.1.1 and workspace packages at runtime; root `package.json` gained the one-line `illus:export-feedback` script.
- **W2**: the gateway must forward `image` for the `critic` role to the provider (the request schema carries it; W10 did not verify the provider call).

## Consequences

- The reader can turn the critic on as soon as W9 wires `criticHook`; repair after L4/L5 needs W3's hook change.
- Live eval numbers for traces and the critic come from the reader, not `pnpm eval --live`.
- Changing the `critic` or `repair` prompt version requires `ILLUS_WRITE_FIXTURES=1 pnpm --filter @illus/evals test quality-prompts` to re-key the hand-written fixtures.
