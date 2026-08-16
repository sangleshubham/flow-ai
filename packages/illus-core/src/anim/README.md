# Animation reducer and validation (W6)

DOM-free implementation of spec §11, re-exported through `@illus/core`.

`buildFrames(ir, animation, {templates?})` returns frame zero plus one precomputed immutable frame per step. It resolves target addresses and renderer capabilities, clones template seeds, and checks the projected template schema and invariants after every step. `apply(frame, actions)` is the pure reducer; callers should use `buildFrames` for untrusted animation data.

Highlights and pointers persist; annotations and tokens expire at the next step. Swaps exchange position contents, including set overrides. Structural actions set `relayout`; style actions preserve layout. Container names and seeds come from the template registry.

`validateAnimation(ir, unknownAnimation, {templates?, grounding})` returns `{ok, issues, animation?, frames?}`. Issues are core `ValidationIssue` values with `layer: animation`. Grounding accepts a core `GroundingContext` whose block map contains **only the permitted context blocks**. Without that map validation fails. Successful narration evidence contains corrected block ids and offsets.

```ts
import { buildFrames, validateAnimation } from '@illus/core'
const result = validateAnimation(ir, animation, {
  templates,
  grounding: { blocks: permittedSectionBlocks },
})
const frames = result.ok ? result.frames : undefined
// Target-only construction when narration was already validated:
const precomputed = buildFrames(ir, animation, { templates })
```

`validateAnimationWithRepair(ir, input, options, repair)` invokes the caller's repair callback once on failure and returns `staticFallback: true` if repair fails. It never calls a model itself. Pipeline adapters can return `validateAnimation(...).issues` and keep the validated static visual.

Tests: reducer unit cases and 200-run fast-check properties cover determinism, immutable bases, arbitrary visibility/highlight sequences and per-frame array permutation invariants. Real W5 schema/invariant integration (heap and capacity failures) lives in `@illus/anim` tests, preserving core's package direction.
