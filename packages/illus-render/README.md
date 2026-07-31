# @illus/render

React renderers for every visual kind (spec §10), the shared chrome and theme tokens, the ELK layout worker, SVG/PNG export and the sandboxed HTML fallback (§17).

- Owner: W4 (W5 owns `src/templates`, W10 owns `src/check`)
- Spec: §3 runtime rules, §10, §11 (frame states), §17 (SVG and sandbox rows)
- Decisions: [ADR 0006](../../docs/adr/0006-render-input-and-element-ids.md)

## Public API

Everything public is exported from `src/index.ts`.

| Export | What it does |
| --- | --- |
| `<VisualView spec frame theme … />` | Draws one visual: header (title, kind, "92% grounded", "simulated"/"unverified"), pan/zoom surface, footer (new/earlier legend, actions, SVG/PNG export). Props: `VisualViewProps`. |
| `VisualSpec` | `{ ir, title?, groundingScore?, newIds?, mathBlock?, layout? }`. The renderer derives engine input from the validated IR. |
| `EvidenceEvent`, `onEvidenceHover`, `onEvidenceClick` | `{ irId, target, label, evidence }` for the element under the pointer, focused (keyboard) or clicked. Hover sends `null` on leave. |
| `RenderTemplate`, `TemplateViewProps` | The interface W5's templates implement (`TemplateSpec` + `layout(props)` + `Component`). Pass a registry as `templates`. |
| `layoutGraph(input, { signal })` | `LayoutGraphFn`: elkjs in a dedicated worker via Comlink, §10 options, results cached in memory. `hints` switch ELK to interactive mode (W8, §11 relayout). |
| `runElkLayout(elk, input)`, `graphLayoutInput`, `nodeSize`, `wrapLabel`, `canvasMeasure` | The worker body and the measuring step, reusable (W5 `graph-ds` uses `algorithm: 'stress'`). |
| `readFlowTheme()`, `watchFlowTheme(cb)`, `useFlowTheme()`, `tokensFromFlowVars()`, `themeVars()` | The ten `--illus-*` tokens from Flow's Material variables and `dark` class, updated on theme change. |
| `irElements(ir)`, `evidenceIndex(ir)`, `elementFrame(frame, target)` | The element/target scheme below and how a `FrameState` applies to one element. |
| `toMermaid`, `renderMermaidSvg`, `tagMermaid`, `toVegaLite`, `sampleFn`, `markTexTerms`, `layoutTimeline` | Pure IR → engine compilers and the post-processors. |
| `exportSvg(root, theme)`, `exportPng(root, theme, scale = 2)` | Standalone SVG (tokens and frame styles inlined, background added) and a 2× PNG. The critic (W10) uses `exportPng`. |
| `sanitizeSvg`, `sanitizeMathMl`, `sanitizeKatex` | DOMPurify profiles used for every injected markup string. |
| `Surface`, `Header`, `Footer`, `ILLUS_CSS` | Chrome pieces for views drawn outside `VisualView` (W7's trace view). |

### Element ids and targets

Every rendered element carries `data-ir-id` (its IR id) and `data-target` (the §11 `Target` string):

| Kind | `node:` | `edge:` | `msg:` | `group:` | `item:` |
| --- | --- | --- | --- | --- | --- |
| graph | nodes | edges | | groups | |
| sequence | participants | | messages (line and text) | | |
| state | states | transitions | | | |
| class | classes | relations | | | fields `Cls.f0`, methods `Cls.m0` |
| er | entities | relationships | | | attributes `Ent.a0` |
| chart | | | | | series `series-0` |
| math | | | | | terms `term-0` (table row and the symbol in the formula) |
| timeline | events | | | lanes | |
| template | (W5) | | | | evidence paths |

### Frames

Renderers draw the static spec; the shared surface applies the `FrameState` to every kind the same way: `illus-hidden`, `illus-removed`, `illus-tone-<tone>`, `illus-new`/`illus-earlier` classes on `[data-target]` elements, and an overlay with pointers (`[data-pointer]`), values (`[data-value-for]`), annotations (`[data-annotation-for]`) and tokens (`[data-token-id]`, placed at the midpoint of the last edge of their path, with `data-token-path` for W6's tween). `focus` pans and zooms the camera. Graph `add` actions are laid out with the previous positions as hints. Templates handle frames themselves (`data-illus-frame="self"`).

`data-ready="true"` on `.illus-view` marks the end of layout/rendering (render checks and tests wait for it).

## Example

```tsx
import { VisualView, useFlowTheme } from '@illus/render'

function Pane({ record, frame, bridge }) {
  const theme = useFlowTheme()
  return (
    <VisualView
      spec={{ ir: record.ir, groundingScore: record.validation.groundingScore, layout: record.layout }}
      frame={frame}
      theme={theme}
      flags={flags}
      templates={templateRegistry}
      onLayout={(layout) => saveLayout(record.cacheKey, layout)}
      onEvidenceHover={(e) => (e ? highlightQuote(e.evidence) : bridge.clearHighlights('evidence'))}
      onEvidenceClick={(e) => scrollToQuote(e.evidence)}
      actions={{ onRegenerate, onKindOverride, onVote, vote: record.feedback?.vote }}
    />
  )
}
```

## Integration notes (apps/reader, W9/W11)

- Import `katex/dist/katex.min.css` in `_app.tsx` (Next.js 12 allows global CSS only there) and serve its fonts from `'self'`.
- Add `@illus/render`, `mermaid`, `vega*`, `katex`, `elkjs` and `comlink` to `next-transpile-modules`; the layout worker is created with `new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })`.
- Under the app CSP, call `z.config({ jitless: true })` once at startup; Zod 4 otherwise probes `new Function` and reports a (harmless, caught) `script-src` violation.
- `/illus-sandbox.html` (in `apps/reader/public`) carries its §17 CSP as a `<meta>` tag; W11 sends the same policy as a header and must not add `frame-ancestors 'self'` there.
- Zoom is ctrl/⌘ + wheel or pinch; a plain wheel keeps scrolling the pane (ADR 0006).

## Tests

- `pnpm test`: Vitest, unit (pure compilers, layout under Node, theme, elements) and jsdom component tests.
- `pnpm e2e`: Playwright in Chromium against a Vite harness (`test/harness`) served under the ADR 0001 CSP. Visual baselines for every renderer in light and dark (`test/e2e/__screenshots__`, platform-suffixed; only `darwin` baselines exist so far), evidence ids and callbacks, frames, export, the layout worker, XSS and sandbox tests. Update baselines with `pnpm e2e --update-snapshots`. First run: `pnpm exec playwright install chromium`.

## Scripts

- `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm e2e`
