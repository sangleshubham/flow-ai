# ADR 0034: W6 animation frame validation and player integration

Status: Accepted within W6 scope; integration notes for W3/W9/W0

## Context

Spec §11 defines reducer, grounded validation, repair fallback and playback; frozen contracts v1.3 provide semantic template targets and seeds. Core cannot import the renderer registry, so the caller must supply that port. W3 has an injected animation validation seam. W7 traces need transport controls without fabricated narration evidence.

## Decision

- Publish reducer and validation through the existing `@illus/core` root re-export (no new subpath/shim). No frozen schema or port changes. Player and generic controls are public through `@illus/anim`.
- `validateAnimation` requires `GroundingContext.blocks` containing only current permitted context blocks, never all indexed book blocks. It returns core ValidationIssue objects plus corrected AnimationIR and precomputed frames on success. W3 can adapt `.issues` through its existing hook, supplying the context map. W9 owns wiring, caching and the flag.
- One repair callback is caller-supplied; failure returns static fallback. W6 never calls live models. W3 controls the replay-capable repair call.
- Swaps exchange position contents and set overrides. Template seeds are cloned. Frame invariants are checked on projected semantic props, not original props. Unsupported or invalid intermediate semantics fail conservatively before playback.
- Add parent addresses follow each template's documented convention: node/stage id normally, numeric bucket index for hash tables. Added targets are available in action order. Container names are stack/queue/frames/order. Tree adds fill left then right, matching W5.
- Generic controlled PlaybackControls and usePlayback permit W7 to reuse transport over executed trace steps without inventing AnimationIR evidence. Player mounting remains behind `animations`; W6 does not enable the flag.
- The prompt and replay fixtures use original synthetic adjacent-swap and request/reply passages. Keys can be computed from explicit prefix/body. These are worked examples, not recordings for every reader section.

## Dependencies and verification

Motion 13.4.3 is already pinned in docs/dependencies.md (released 2026-09-24, 15 days before the build date; React18 compatible). Install materialises that approved pin. Existing documented pins are reused for React18, type declarations, Testing Library, jsdom, Playwright and Vite. W0 owns final dependency documentation and lock integration. The test-only @illus/render import requires including its ambient d3-hierarchy declaration in the W6 tsconfig; no new d3 type dependency is introduced.

## Consequences

Grounding without a permitted block map fails explicitly. The app can keep its static visual on any validation/repair error. Renderer targets use data-target; token overlays use data-token-id. W9 must memoise frame arrays and forward evidence callbacks into the reader bridge. Full EPUB-to-animation integration belongs to W9; W6 browser tests verify actual rendering and playback in the isolated replay harness.
