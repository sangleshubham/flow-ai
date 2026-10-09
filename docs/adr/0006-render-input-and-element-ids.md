# 0006 — Renderer input, element ids and other W4 decisions

- Status: proposed
- Date: 2026-10-09
- Workstream: W4
- Spec sections: §5, §8 stage 3, §10, §11, §17, §19

## Context

§10 calls renderers "pure functions of `(spec, frameState, theme)`" and §8 stage 3 has `@illus/core/compile` (W3) turn IR into renderer-ready specs: ELK graph JSON, Mermaid source, Vega-Lite, KaTeX input, lane layout. In contracts v1.0 `VisualRecord.spec` is `unknown`, W3's compilers do not exist yet, and W4 must not build against unfinished code. Several parts of the compile step also need the DOM (text measured with canvas before ELK, Mermaid ids that only exist after rendering). Some §10 wording could not be followed literally.

## Decision

1. **`VisualView` takes the validated IR.** `VisualSpec = { ir, title?, groundingScore?, newIds?, mathBlock?, layout? }`. The IR → engine step lives in `@illus/render` as pure, exported functions (`graphLayoutInput`, `toMermaid`, `toVegaLite`, `markTexTerms`, `layoutTimeline`). `mathBlock` is passed in because renderers never fetch (§3).
2. **Mermaid ids are positional aliases** (`n0`, `n1`, … in IR order), not raw IR ids: `stateDiagram-v2` rejects hyphens (allowed by `IrId`) and every diagram type has reserved words (`end`, `state`…). `tagMermaid` maps aliases back and tags messages, transitions, relations, class members and ER attributes by emission order. Escaping: sequence text uses Mermaid entity codes; state/class/ER labels swap `;`, `"`, `{`, `}`, `~` for look-alike characters (entity codes are not decoded there). Labels render as SVG text (`htmlLabels: false`), so DOMPurify's SVG profile can drop `foreignObject`.
3. **Element ids.** Every element carries `data-ir-id` and `data-target` (the §11 target). Elements without an IR id get derived ids: class members `Cls.f0`/`Cls.m0`, ER attributes `Ent.a0`, chart series `series-0`, math terms `term-0`; timeline lanes are `group:`, events `node:`.
4. **Frames are applied once, by the shared surface**, for every non-template kind (classes plus an overlay for pointers, values, annotations and tokens; `focus` drives the camera). Hidden graph elements stay in the layout so reveals do not move anything; only `add` re-runs ELK, with the previous positions as hints.
5. **Wheel zoom needs ctrl/⌘** (trackpad pinch sends `ctrlKey`). A bare wheel keeps scrolling the pane instead of trapping it. Drag pans, two-finger pinch zooms, double-click resets to fit-to-width.
6. **elkjs in our own Comlink worker.** `elk.bundled.js` registers itself as a raw worker when it sees no `document`; a placeholder `document` during its first construction (`src/graph/elk-shim.ts`) keeps it in-thread inside our worker.
7. **HTML fallback**: the sandbox page accepts exactly one message, only from `window.parent`, and writes it with `document.open/write/close`; it also carries the §17 CSP as a `<meta>` tag. Fixed 400 px height with internal scroll (no auto-size messages from untrusted content).
8. **Test tooling**: Playwright runs against a Vite dev server (`harness.vite.config.ts`) under the ADR 0001 CSP. `vite` 8.3.1 is already in the lockfile through Vitest; W4 adds it as a direct devDependency.

## Consequences

- **Contract-change request (W3, orchestrator):** decide what `VisualRecord.spec` holds for IR kinds. Proposed: the pipeline stores `null` (or the IR again) and `VisualRecord.layout` holds the graph layout; `@illus/core/compile` does not duplicate `toMermaid`/`toVegaLite`. If W3 must own them in core, the pure modules `src/mermaid/source.ts`, `src/chart/vega-lite.ts`, `src/math/tex.ts` and `src/timeline/layout.ts` can move to `@illus/core/compile` unchanged (they are DOM-free) and `@illus/render` imports them from core. §8 stage 3 step 6 (`mermaid.parse` on compiler output) is covered by `test/mermaid-source.test.ts`.
- **Spec wording (§10)**: "the compiler emits our IR ids as Mermaid ids" becomes "aliases mapped back to IR ids" (decision 2).
- **Dependencies (W0, `docs/dependencies.md`)**: add rows for `vite` 8.3.1 (dev, harness), `@types/react` 18.3.31 and `@types/react-dom` 18.3.7 (dev; the file says "needs @types/react 18" without a pin), `@types/node` 24.13.6 in `@illus/render` (dev), and React 18.0.0 as dev/peer of `@illus/render`. Runtime pins used are the ones already listed, plus the approved `vega-interpreter` 2.3.2.
- **W9**: import KaTeX CSS in `_app.tsx`, transpile the ESM renderers, call `z.config({ jitless: true })` (see package README).
- **W11**: send the sandbox CSP header on `/illus-sandbox.html`; leave `frame-ancestors` off that path.
- **CI (W0)**: visual baselines exist for `darwin` only. Running `pnpm e2e` on Linux CI needs Linux baselines (generate with the Playwright Docker image) or a macOS runner.
- **W5**: implement `RenderTemplate` (`src/types.ts`), call `onReady` from an effect, mark the root `data-illus-frame="self"`.
- **W8**: pass its interactive `LayoutGraphFn` or call `layoutGraph` with `hints`.
