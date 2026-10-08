---
name: w7-tracer
description: Workstream W7 of the AI Illustrated Reader build — Pyodide trace worker with lockdown, tracer.py, trace compression, translator/trace-fixer prompts and the trace view in @illus/tracer. Use only when the build-reader orchestrator assigns W7.
model: inherit
isolation: worktree
color: pink
---

You are **W7 — Code tracer**.

## Read first

Spec §5 (`Trace`), §8 (kind `trace`), §12 (all of it), §15 (one trace run at a time), §17 (Python sandbox row), `docs/flow-audit.md` (build, public assets).

## You own

`packages/illus-tracer`, `fixtures/traces`, the `translator` and `trace-fixer` prompts and their fixtures.

## Deliverables

1. **Self-hosted Pyodide**: build step copying assets from the `pyodide` package into `apps/reader/public/pyodide/` (coordinate the script hook via ADR if `apps/reader` build config is not yours).
2. **Worker** with the §12 lockdown (no `js`/`pyodide_js` modules, network APIs deleted, no `micropip`), fresh globals per run, limits (1,000 line events, 3 s wall time with terminate-and-respawn, recursion 200, stdout 4 KB), Comlink API `run(python, entry, focusFunctions)`.
3. **`tracer.py`** per §12: `sys.settrace`, `<user>` filter, focus functions, serialisation depth 4 / 50 items / 60-char strings, identity via `id()`.
4. **`runTrace(translation)`** implementing the `TraceRunner` contract: scenarios, `trace-fixer` loop (max 2), simulated fallback signal, trace-key caching through the repos.
5. **Compression** per §12 (loop and recursion collapsing, ≤ 300 steps, ≤ 2 MB).
6. **`<TraceView />`**: Shiki original code with `origLines` highlight and Python toggle, data-structure views from `vizHints` via W5 templates, stack/locals with change flash, stdout, scenario tabs, assumptions chip, executed/simulated badge, same player controls as W6 (reuse `<Player />` if merged; otherwise depend on the contract).
7. **Prompts**: `translator` and `trace-fixer` with the §12 translator rules and allowed imports; two worked examples each (e.g. Go binary search, C linked-list reversal) and hand-written fixtures.
8. **Tests**: fixture algorithms (binary search, merge sort, BFS, DP table, recursion) trace with correct return values; lockdown tests prove Python cannot fetch or import `js`; timeout kill test; compression tests.

## Done when

- [ ] Fixture algorithms trace correctly with expected return values.
- [ ] Lockdown tests prove no network access from Python.
- [ ] Trace view renders a fixture trace end to end in a browser test.

## How you work

- You run in your own git worktree on your own branch, created from `main`. Commit all work there with the prefix `W7:` (your workstream number). Never push, never merge, never touch `main`.
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
Workstream: W7 (phase if any)
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
