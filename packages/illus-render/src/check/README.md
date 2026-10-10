# @illus/render — render checks, critic and repair loop (`src/check`)

Spec §16 layers L4 (render checks) and L5 (critic), plus the one-repair-per-layer loop. Owner: W10. Exported from `@illus/render`. Decisions: [ADR 0043](../../../../docs/adr/0043-w10-render-checks-critic-repair.md).

## Public API

| Export | What it does |
| --- | --- |
| `checkGeometry(geometry)` | DOM-free L4 checks: two labels of different elements overlapping by more than 2 px (`label-overlap`), a node label wider than its shape (`text-overflow`), aspect ratio beyond 4:1 (`aspect-ratio`), more than 10 edge crossings (`edge-crossings`). Every finding is a `render` **warning**. |
| `countCrossings(edges)`, `aspectRatio(size)`, `RENDER_LIMITS` | The pieces behind it. |
| `collectGeometry(svg)`, `checkRender(root)` | Browser: measures `data-ir-id` label boxes, node shapes (`data-target="node:…"`) and edge paths (`data-target="edge:…"`, sampled every 6 px) of a rendered SVG and runs the checks. |
| `renderForReview(ir, { theme, templates })` | Browser: renders the IR offscreen with `<VisualView>` in a 900 px host, waits for `data-ready`, runs `checkRender`, and exports the PNG for the critic (natural size capped at 900 px, at 2×). Math and HTML visuals have no SVG: no findings, no PNG. |
| `reviewVisual(record, env)` | The loop for one stored visual: render → L4 → for graphs a deterministic `LR`↔`TB` retry (kept when it fixes the aspect ratio) → one `repair` for the remaining findings → `critique` → one `repair` with the critic's issues → `critique` again. A repaired IR is adopted only when it re-validates cleanly against the same permitted blocks. Remaining findings stay on `validation.issues` as warnings, a failing critic report stays on `record.critic` (the pane's warning badge). Plan-limit and abort errors propagate; other model errors become warnings. `env.critic: false` turns L5 off; without `env.repair` nothing is repaired. |
| `criticHook(env)` | Adapter for today's `PipelineDeps.critic(record) => CriticReport` hook (render checks and critic, no repair: the hook cannot return a new IR). |

`critique()` and `repairIr()` themselves are DOM-free and live in `@illus/core` (`src/validate`).

## Example

```ts
import { criticHook, templateRegistry, readFlowTheme } from '@illus/render'

createPipeline({
  ...deps,
  // Only called when the `critic` flag is on.
  critic: criticHook({ llm, theme: readFlowTheme(), templates: templateRegistry, intent: (r) => intentOf(r) }),
})
```

## Tests

- `src/check/test/*.test.ts` (Vitest): geometry checks and the review loop with fake renders and a fake `LlmCall`.
- `src/check/e2e/check.e2e.ts` (Playwright, Chromium): real measurements, the PNG size and the aspect-ratio flip. Run `pnpm exec playwright test -c src/check/e2e`.
