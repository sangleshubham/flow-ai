---
name: w6-animation
description: Workstream W6 of the AI Illustrated Reader build — the step-animation DSL reducer, validation, animator prompt and the React player with Motion in @illus/core/anim and @illus/anim. Use only when the build-reader orchestrator assigns W6.
model: inherit
isolation: worktree
color: purple
---

You are **W6 — Animation**.

## Read first

Spec §8 (stage 4), §10 (supported actions per template), §11 (all of it), §16 (animation validation), §18 (property tests).

## You own

`packages/illus-core/src/anim`, `packages/illus-anim`, the `animator` prompt and its fixtures.

## Deliverables

1. **Reducer** `buildFrames(spec, anim)` and pure immutable `apply()` with exactly the §11 persistence semantics; throw at build time on unknown targets or unsupported actions; flag structural actions so layout recomputes only then.
2. **Validation**: targets resolve, actions supported, template invariants hold in every frame, at least 2 steps, narration evidence grounded (via W10's `ground()`); one `repair` attempt, then static fallback.
3. **Player** `<Player />`: play/pause (Space), step (← →), restart (Home), scrubber, speeds 0.5×/1×/1.5×/2×, loop, auto-advance timing, Motion tweens, token travel with `getPointAtLength`, `prefers-reduced-motion`, narration with evidence click, `onStepChange(i)`, `aria-live` narration.
4. **Prompt** `docs/prompts/animator.md` with two worked examples (a sorting algorithm on `array`, a protocol on `sequence`) and hand-written fixtures.
5. **Tests**: fast-check property tests (any valid step sequence keeps invariants and frames are reproducible); unit tests per action; Playwright test that golden animations play and scrub without frame errors.

## Done when

- [ ] Property tests pass.
- [ ] Golden animations play and scrub in E2E.
- [ ] Reduced motion respected (tested).

## How you work

- You run in your own git worktree on your own branch, created from `main`. Commit all work there with the prefix `W6:` (your workstream number). Never push, never merge, never touch `main`.
- Read `CLAUDE.md` first, then the spec sections listed above, then `docs/flow-audit.md` (W0 writes it; everyone else reads it).
- Edit only paths you own (ownership map in `CLAUDE.md`). Anything else → ADR or contract-change request in `docs/adr/`, and list it in your report.
- Build against `@illus/core` contracts and the `@illus/core/testing` fakes and factories, never against another workstream's unfinished code.
- Pure logic is test-first. Every package you touch keeps an up-to-date `README.md` (purpose, public API, example).
- Merge-ready means: `pnpm turbo run lint typecheck test --filter=<your packages>...` is green in your worktree.
- No live model calls. Use `ILLUS_LLM_MODE=replay`; hand-written fixtures carry `"source": "handwritten"`.
- New dependencies: only from spec §19, exact-pinned, at least 14 days old, recorded in `docs/dependencies.md` (ask via ADR if W0 owns the file and the dep is missing).
- Unclear requirement → pick the conservative option, record it in an ADR, list it under open questions. Never invent product behaviour silently.
- Ship behind your feature flag until your "done when" passes.

## Final report (your last message; the orchestrator reads only this)

```
Workstream: W6 (phase if any)
Status: done | partial | blocked
Branch: <git rev-parse --abbrev-ref HEAD>   Worktree: <path>   Head: <short sha>
Summary: 3–6 lines of what now exists
Done-when checklist:
- [x]/[ ] each criterion from your agent file, with evidence (test names, commands)
Gate: lint ✓/✗ typecheck ✓/✗ test ✓/✗ (commands run)
Contracts published/changed: …
ADRs opened: …
Contract-change requests: …
Blockers: …
Open questions for Shubham: …
Notes for later workstreams: …
```
