# @illus/anim

W6's React player for precomputed core animation frames. Mount only when the `animations` feature flag is enabled by the reader. This package performs no model calls and stores no book data.

```tsx
import { Player } from '@illus/anim'
import { buildFrames } from '@illus/core'
const frames = buildFrames(ir, animation, { templates })
<Player
  frames={frames}
  renderFrame={frame => <VisualView spec={{ir}} frame={frame} theme={theme} templates={templates} />}
  onStepChange={index => syncStep(index)}
  onEvidenceClick={evidence => scrollToEvidence(evidence)}
  onEvidenceHighlight={evidenceOrNull => highlightWhilePlaying(evidenceOrNull)}
/>
```

`PlayerProps`: `frames: readonly FrameState[]`, `renderFrame(frame): ReactNode`, and optional callbacks shown above. Index zero is the base frame. A new frames array resets playback. Memoise frames, theme and callbacks in application integrations. `onEvidenceHighlight(null)` clears the book highlight on pause, unmount or when automatic highlighting is unchecked. Narration is an accessible button inside an `aria-live` region.

Optional persisted settings: `defaultSpeed?: number` accepts 0.5/1/1.5/2 (defaults to 1; invalid values fall back to 1), applies on mount and whenever that prop changes, and preserves manual speed choices between settings changes. `reducedMotion?: boolean` overrides the system preference; omit it for the reader's `system` setting, pass `true` for `on`, or `false` for `off`. `usePlayback` also accepts optional `initialSpeed?: number` with the same speed semantics; its existing return value and controlled transport props are unchanged.

Controls: play/pause, previous/next, restart, range scrubber, 0.5×/1×/1.5×/2× speed, loop. Focus the player for Space, arrows and Home. Native form and button keys are preserved. Delay is `max(1500, narration.length * 45) / speed`. Motion tweens position, visibility and highlight colour; token overlays follow semantic edge paths for 600ms/speed, including the renderer's HTML and template SVG overlays. Reduced motion switches frames and tokens instantly.

`PlaybackControls` is evidence-independent controlled transport for W7 traces. Props: `{count,index,onIndex,playing,onPlaying,speed,onSpeed,loop,onLoop}`. `usePlayback({count,index,onIndex,delayMs?})` returns `{playing,setPlaying,speed,setSpeed,loop,setLoop}` and performs auto-advance; supply these to the controlled component. Set `delayMs` to customise trace timing. `count` includes the base frame if one exists.

Scene timelines (graph IRs, ADR 0050): `readSceneGeometry(svg)` reads the `data-layout` and `data-box` attributes that `GraphView` writes (null until laid out), and `buildSceneTimeline(svg, compileSceneTimeline(ir, frames, geometry.boxes, geometry.full))` returns `{ tl, ctx }`: a paused GSAP master timeline with labels `s0…sN` (label `sI` is the finished picture of step `I`; `tl.seek` and `tl.tweenFromTo` jump between them) and the `gsap.context` that owns everything it created. `ctx.revert()` removes the overlay (token dots, annotations) and restores the static SVG. GSAP writes SVG transforms as `transform` attributes, and React renders one on each node's outer `<g>`, so GSAP only animates the inner `[data-anim-body]` wrappers and its own overlay elements; the camera group is moved through a `sceneCamera` plugin (a tween callback would be skipped by `seek`). The browser harness exposes `window.__scene` for the e2e tests only.

Validation: `pnpm -F @illus/anim test` (component, real template invariants, grounding, repair) and `pnpm -F @illus/anim e2e` (actual array, Mermaid sequence and graph renderers). Browser goldens test play/pause, stepping, scrubbing, keyboard restart, token path travel and reduced-motion endpoint placement. Test assets use original synthetic text. Playwright runs a dedicated Vite harness at port 5206; browser results are ignored locally.

Dependencies use the pins already documented by W0; Motion 13.4.3 is the spec's approved runtime pin. ADR 0034 records integration and target decisions. The test tsconfig includes W5's ambient d3-hierarchy declaration because the renderer's entry point exposes its template registry.
