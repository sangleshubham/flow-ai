# 0038 — Self-hosted trace worker headers and container fixtures

- Status: accepted
- Date: 2026-10-09
- Workstream: W11
- Spec sections: §9, §12, §17

## Context

W7 publishes a module worker and pinned Pyodide assets into the reader's public directory. A worker cannot bootstrap Pyodide under `connect-src 'none'`: trusted startup must read local wasm and stdlib files before executing translated Python. The main app policy contains EPUB-specific allowances that the trace worker does not need. ADR 0031 also requires explicit fixture paths for standalone containers, which do not contain a workspace manifest.

## Decision

Serve `/illus-trace-worker.mjs` with `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. Keep the app CSP unchanged and make header rules disjoint, including the HTML sandbox. Local Pyodide asset responses retain the app headers; imported modules execute under the entry worker's CSP. This permits trusted bootstrap only; W7 must remove network APIs and Python bridge access before executing untrusted code, and terminate workers on timeout. No nested worker, external origin, inline script or JavaScript eval exception is introduced.

W9 owns reader prebuild/predev wiring and the tracer workspace dependency. The existing Docker filtered install and reader build use that wiring; W11 adds explicit assertions for generated runtime assets and copies them through the public directory. W7 owns the asset generator and excludes generated outputs from git.

Set an explicit `/fixtures/llm` default in the image and compose configuration, with a read-only repository fixture bind mount in compose. Recording explicitly selects a writable `/data/fixtures/llm` path inside the existing data volume. Live mode remains independent of fixtures; the default mode remains replay and no model calls run at build time.

## Consequences

Production header tests check worker policy and asset endpoints; W7 tests verify bootstrap and runtime lockdown. Final container verification depends on merging W7 assets and W9 build hooks. Recordings belong in private data-volume backups, never the checked-in replay fixture directory. No shared schema, dependency or authentication-policy changes are needed.
