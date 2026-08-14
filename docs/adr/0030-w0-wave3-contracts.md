# 0030 — Contracts v1.3 and wave 3 CI prerequisites

- Status: accepted
- Date: 2026-10-09
- Workstream: W0
- Spec sections: §4, §5, §10, §11, §18, §19

## Context

W5's [ADR 0015](0015-w5-template-library.md) requests DOM-free animation targets and frame seeds in `TemplateSpec`. W5 already implements the hooks, but W6 cannot use them through the frozen core contract. The core array factory still uses record-form pointers rejected by W5's array schema. Wave 2 also changed the reader dependency manifest and added production security browser tests that CI does not run. Shubham approved these prerequisites before resuming wave 3.

## Decision

1. Bump contracts and `@illus/core` to v1.3.0. Add optional `targets?(props): string[]` and `initialFrame?(props): Partial<Pick<FrameState, 'pointers' | 'containers'>>`. Strings returned by `targets` must parse as `Target`; W6 enforces that and resolves actions against the returned targets. W5 implementations remain structurally compatible. Neither hook touches the DOM or mutates props. The reducer clones the seed before applying actions.
2. Frame seeds retain W5's current semantics: pointer names map to targets; containers contain their full current item lists. W5 container names are `stack`, `queue`, `frames` and `order`. Positions remain targets when `swap` exchanges contents. No new animation actions or frame fields are introduced.
3. Correct `make.templateIR()` to `pointers: [{ name: 'majority', index: 1 }]`, with evidence paths `values` and `pointers.0`. Update W0 regression tests; W10 updates its own test-only template stub separately to the approved shape.
4. Synchronize `docs/dependencies.md` with the existing wave 2 manifests: Next 12.3.7, removed reader cloud dependencies, and reader Vitest/Playwright dev dependencies. No dependency is added or repinned by this amendment.
5. Run reader Chromium E2E in CI after `next build`. Install Chromium and Linux system dependencies with the pinned Playwright CLI, then use `E2E_SKIP_BUILD=1` to test that production build. The reader Playwright configuration supplies throwaway credentials and replay mode. Current renderer screenshots are darwin-only; renderer Linux visual baselines and their CI checks remain deferred until generated and approved.
6. Ignore the local `.pnpm-store/` build artifact. Keep its contents intact.

## Consequences

Existing template producers and consumers can omit both hooks. W6 can depend on core contracts rather than importing React template internals. Contract tests cover optional hooks, frame seed compatibility, and factory paths; renderer typechecking verifies W5's existing hooks remain compatible. W10's obsolete test stub must be amended before the combined full gate can pass. CI adds a real reader browser check but does not claim Linux visual coverage or live model quality.
