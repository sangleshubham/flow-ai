# 0050 — Scene player for graph animations (GSAP)

- Status: accepted
- Date: 2026-10-16
- Workstream: W0 (foundation), W6 (player), W4 (renderer), W3 (fallback), W9 (pane)
- Spec sections: §4, §5, §11, §17, §19

## Context

Graph animation can pile boxes onto the left edge when a tween overwrites the outer SVG node's React-rendered `transform="translate(x, y)"`. Separately, hiding a node can leave an arrow pointing into empty space. The current Player's before/after DOM measurements (FLIP) depend on the timing of React rendering and asynchronous layout; measuring intermediate pictures makes seeking and scrubbing fragile. A fixed layout also leaves empty slots when most nodes are hidden.

[Spec §11](../spec.md#11-step-animations-timeline-dsl-and-player) prescribes Motion transitions and a static fallback after failed animator repair. [Spec §19](../spec.md#19-dependencies-and-documentation-index) does not list GSAP. This ADR authorizes the graph-only scene approach and its additional dependency without changing those sections silently.

## Decision

Implement the graph scene player behind `sceneAnimations`, owned by W6 and **off by default**. Both `animations` and `sceneAnimations` must be enabled to select it. Other IR kinds retain the current Player. The graph structure remains static: graph actions support highlight, unhighlight, hide, reveal, annotate, focus and token, rather than structural add/remove/swap.

1. Derive a complete scene for every frame. Edges require both endpoint nodes to be visible; derived visibility also handles groups and excludes tokens on hidden edges.
2. Lay out the complete graph once with ELK, keep every outer node at that position, and move a camera to fit the visible scene. Playback performs no intermediate DOM measurements.
3. Compile the complete sequence into a declarative timeline, then build one paused GSAP master timeline with labels `s0` through `sN`. Controls play between labels or seek directly; reduced motion uses seeks. Explicit initial state must be restored when seeking backwards.
4. Provide a deterministic reveal-in-flow-order storyboard when the animator throws or repair remains unusable. Validate the fallback with the same animation schema and grounding checks; retain the static visual if the fallback also fails.

The flag affects presentation only. Do not add it to the pipeline's `KIND_FLAG` or plan-key kinds: switching players must reuse the same cached plan and illustration.

### GSAP pin and APIs

Add exactly `gsap@3.15.0` to `@illus/anim`. [npm registry metadata](https://registry.npmjs.org/gsap) records publication at `2026-04-13T13:15:35.800Z`, well beyond the 14-day minimum on the decision date. The installed manifest declares ESM, bundled TypeScript types, and exports for these imports:

```ts
import { gsap } from 'gsap'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'

gsap.registerPlugin(DrawSVGPlugin, MotionPathPlugin)
```

All plugins have been available free through public npm since [3.13](https://gsap.com/blog/3-13/). The package uses the [GSAP Standard “no charge” licence](https://gsap.com/standard-license), which is non-OSI and accepted for this personal deployment. This does not relicense GSAP under Flow's licence. Record the exception in [dependencies](../dependencies.md). Motion replaces nothing yet and remains for the old Player; do not add `@gsap/react`.

Use `gsap.timeline({ paused: true })`, `addLabel`, `labels`, `seek` and [`tweenFromTo`](<https://gsap.com/docs/v3/GSAP/Timeline/tweenFromTo()>). The latter returns a playhead tween with its duration determined immediately. Timeline `fromTo` calls must set [`immediateRender: false`](<https://gsap.com/docs/v3/GSAP/Timeline/fromTo()>) to avoid painting future steps during construction. Build inside [`gsap.context`](<https://gsap.com/docs/v3/GSAP/gsap.context()>) scoped to the SVG and call `ctx.revert()` on rebuild/unmount; return cleanup for manually created overlay elements.

**SVG transform ownership:** [CSSPlugin](https://gsap.com/docs/v3/GSAP/CorePlugins/CSS/) writes SVG transforms to the transform attribute. Never tween `x`, `y`, `scale` or `rotation` on an element whose transform React renders. Animate a nested `[data-anim-body]` instead. Tween a camera proxy whose update writes the camera group's transform; React renders no transform there.

[DrawSVGPlugin](https://gsap.com/docs/v3/Plugins/DrawSVGPlugin/) controls stroke dash array and offset on SVG geometry. Dashed edges must fade in rather than draw, preserving their dash pattern. [MotionPathPlugin](https://gsap.com/docs/v3/Plugins/MotionPathPlugin/) uses the edge path with `align: pathEl` and `alignOrigin: [0.5, 0.5]` for centred tokens across nested transforms. Reuse the Player's existing reduced-motion resolution rather than adding a second media-query policy.

## Consequences

W6 owns the pure scene/compiler contracts and GSAP player, W4 adds inner animation bodies, layout metadata, camera and overlay groups, W3 validates the fallback, and W9 wires selection behind both flags. Models continue emitting validated AnimationIR, never animation code. Unit tests cover scenes and compiler output; browser tests cover seeking, camera fit, stable outer transforms, tokens, cleanup and reduced motion.

The default flag map, settings label and generated contracts gain `sceneAnimations`; existing stored settings inherit `false`. A later default flip requires a recorded decision after reading with the flag enabled. Removing the old graph FLIP path is separate work.

No CSP change is needed for the added package: inspection on 2026-10-16 found no `eval(...)` or `new Function` matches in all 117 installed GSAP JavaScript files, including root ESM, `src`, `dist` and minified builds. The requested root-file check also found none. Browser integration still has to verify the new player under the existing production policy; this foundation commit does not instantiate it.
