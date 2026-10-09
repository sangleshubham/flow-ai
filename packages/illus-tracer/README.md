# @illus/tracer

Pyodide trace worker, tracer.py, trace compression and the trace view.

- Owner: W7
- Spec: §12
- Status: implemented; reader enables it behind the `tracer` flag.

## Public API

Everything public is exported from `src/index.ts`. Deep imports are rejected by the boundary lint rules (`tooling/eslint-config`).

- `createBrowserTraceWorker()` owns one reusable, serial worker and enforces execution timeout
  by termination/respawn. Call `dispose()` when the reader session is closed.
- `createTraceRunner({worker, fixer?})` implements the core `TraceRunner` port, runs all scenarios,
  maps original lines and compresses them. Optional fixer is called at most twice; reader pipeline
  consumers omit it because W3 owns LLM accounting and repairs.
- `TraceFallbackError`: structural `code: 'trace-fallback'`, `route`, `reason`, `translation`,
  `repairs`. Routes are `timeline` (concurrency), `none` (IO/UI/etc.) and `simulated-template`
  (execution failed). No simulated event is ever returned as a measured trace.
- `createCachedTraceRunner({...runnerOptions,repos,bookId,codeSource,translator})` optionally
  caches through the frozen repos. The existing section pipeline already owns caching.
- `TRACER_VERSION`, `compressTrace(raw)`, `projectHint(step,hint,hints)` are public pure helpers.
- `<TraceView record originalCode langHint flags controls? onStep?>` shows original/Python code,
  measured structures, stack/locals changes, stdout, scenarios and assumptions. Uses W6's
  `PlaybackControls` and `usePlayback` directly; `controls` optionally overrides the transport.

## Example

```ts
import {
  createBrowserTraceWorker,
  createTraceRunner,
  TRACER_VERSION,
} from '@illus/tracer'
const worker = createBrowserTraceWorker()
const traceRunner = createTraceRunner({ worker })
// Inject {traceRunner, tracerVersion:TRACER_VERSION} into createSectionOrchestrator.
const scenarios = await traceRunner.runTrace({ codeBlockId, translation })
// worker.dispose() on session teardown.
```

## Scripts

- `pnpm lint` · `pnpm typecheck` · `pnpm test` (real Pyodide, no model calls)
- `pnpm build:assets`: copy pinned npm Pyodide/Comlink plus worker/harness into reader public.
  Reader predev/prebuild calls this; the runtime uses no CDN. Generated assets are not committed.
- `pnpm e2e`: builds assets then tests the real worker and fixture trace view in Chromium.

## Sandbox and limits

Trusted bootstrap loads self-hosted WASM/stdlib/harness first, then makes worker network,
nested-worker and persistence APIs undefined/nonwritable. Python bridge modules are blocked;
no micropip is loaded. Runs have fresh globals and restricted builtins/import export facades.
AST validation rejects reflection, private names/attributes, dynamic evaluation, IO and unsupported
async/generator behavior. This supports algorithm translations, not arbitrary Python programs.
Unsupported code receives repair/fallback rather than relaxing isolation. See ADR 0035.

Limits: 1000 user line events, 3-second user execution timeout (60-second separate boot timeout),
recursion 200, stdout 4 KiB, serialization depth4/50 items/60-character strings/200 heap objects,
compressed traces ≤300 steps and ≤2 MiB. Object identities use Python `id()` within each scenario.
Loop compression retains first3/last2 iterations; recursive subtrees deeper than4 frames collapse
to a measured terminal snapshot. Final hard-cap truncation is labelled and keeps the final return.

Array/index-pointer, linked-list/cycle, binary-tree and rectangular-grid hints use W5 templates.
Unsupported hint shapes remain inspectable in locals; no structure is fabricated.

## Fixtures and prompts

`fixtures/traces/` includes binary search, merge sort, BFS, DP and factorial examples. Translator
and trace-fixer prompts each have two worked examples and four schema-valid handwritten replay
fixtures under `fixtures/llm/`. Text is synthetic; no credentials, private books or live calls.
