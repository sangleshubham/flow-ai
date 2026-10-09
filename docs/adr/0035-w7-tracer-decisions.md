# 0035 — W7 tracer execution and integration decisions

- Status: accepted
- Date: 2026-10-09
- Workstream: W7
- Spec sections: §5, §12, §15, §17, §19

## Context

The frozen `TraceRunner` returns scenario traces, while §12 requires explicit untraceable and
simulated fallback routes. W3's pipeline previously stored every result as executed. Pyodide's
stdlib modules also expose implementation imports, so merely restricting import statements
would leave access to modules such as `typing.sys`.

## Decision

- `createTraceRunner` returns executed traces only. A structural `TraceFallbackError` carries
  `code: 'trace-fallback'`, `route: 'timeline' | 'none' | 'simulated-template'`, reason, last
  translation, and repair count. Optional injected fixer retries at most twice. In the reader,
  W3 owns LLM calls, repair accounting, and simulated template/timeline generation; configure
  the runner without its optional fixer so repair ownership is singular.
- The worker first fetches only self-hosted assets, then removes network, nested-worker,
  persistence and bridge APIs. The host serializes runs and terminates/resets a worker after
  at most 3 seconds of user execution; runtime startup has its own 60-second failure deadline.
- Python runs in fresh globals with a restricted builtin dictionary, AST checks that reject
  reflection, private attribute/name access, generators, and dynamic code/IO, and read-only
  stdlib export facades. This deliberately rejects Python outside the supported algorithm
  subset. Unsupported translations go through repair/fallback rather than weakening lockdown.
  It is defense in depth around the spec's worker controls, not a claim that general Python
  can safely be evaluated by a builtin blacklist. Production CSP is independently applied
  by W11; bootstrap needs same-origin fetch, then runtime network APIs are disabled.
- Heap serialization caps depth 4, 50 entries per container, 60-character strings and 200
  objects per snapshot; large integers/nonfinite numbers are represented as text to retain
  JSON interoperability. Raw line events stop at 1000; compressed traces retain ≤300 steps
  and ≤2 MiB. When no exact repeated loop pattern is found, the hard size cap keeps beginning
  and end states and explicitly marks truncation; recursive subtrees deeper than four frames
  collapse to their terminal state. Compression never estimates a return value.
- `TraceView` directly uses public W5 templates for arrays/index pointers, linked lists and
  cycles, binary trees, and rectangular DP grids. Other hints remain visible in locals;
  unsupported shapes are not invented. W6's controlled transport can be injected through
  `controls`, matching its `PlaybackControls` contract; standalone fallback controls use the
  same transport interface until W6 is merged. Browser highlighting uses Shiki tokens in
  React spans. Missing/unsupported language grammars fall back to escaped plain text.
- Build assets are generated, not committed. `pnpm --filter @illus/tracer build:assets` copies
  pinned Pyodide into `apps/reader/public/pyodide/` and the worker, harness and Comlink files
  alongside it. W9 owns reader predev/prebuild hooks; W11 owns worker response CSP and Docker
  copies. All dependencies already have exact pins and dates in `docs/dependencies.md`.

## Consequences

W3 must handle the structural error discriminator and preserve executed/simulated semantics.
W9 must install the build hook, transpile the package and supply the `tracer` flag. W11 must
serve `/illus-trace-worker.mjs` with a dedicated same-origin bootstrap CSP, then rely on the
W7-tested runtime lockdown. W0 should record tracer's React, Vite/Playwright and types usage
and ignore generated assets in the repo `.gitignore`. No frozen core contract changes.
