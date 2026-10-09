# Build log

Written by the `/build-reader` orchestrator. One entry per wave: agents spawned, branches, merge results, gate results, follow-ups.

<!-- entries below -->

## Wave 0 — 2026-10-09
- Agents: w0-foundation
- Branches merged: worktree-agent-ab31651c7da8fa34c (8 W0 commits, head 733898c)
- Gate: lint ✓ typecheck ✓ test ✓ (37/37 turbo tasks) e2e n.a. (`pnpm e2e` exits 0 with no tasks)
- ADRs opened (all proposed): 0001 CSP exceptions, 0002 package boundaries and toolchain, 0003 contract decisions, 0004 CI gate and audit baseline, 0005 Next.js 12 security
- Contract-change requests: add `vega-interpreter` 2.3.2 to §19 (ADR 0001); approve tooling deps `typedoc-plugin-markdown`, jsdom, `@testing-library/dom`, `@types/node`
- Open questions for Shubham (checkpoint, blocks wave 1):
  1. Approve contracts v1.0 and ADR 0003 (ClassIR/ErIR limits, FrameState, array outputs wrapped in object roots, etc.)
  2. Approve CSP exceptions in ADR 0001 (`blob:` in style-src/connect-src, font-src, media-src)
  3. Keep Flow's Dropbox sync and remote-URL import (both blocked under CSP)?
  4. Next.js 12.3.4 critical advisories (middleware auth bypass): interim 12.3.7 + per-route session check + Tailscale-only; migrate to Next 15 after M1, or accept risk? (ADR 0005)
  5. Remove Flow's production Sentry config (reports to upstream author's project)?
  6. Approve W0 edits outside its ownership list (ADR 0004): root tsconfig `paths` fix, epubjs `test` renamed to `test:karma` (Flow's karma tests leave the gate), root package.json pins/scripts, pnpm-workspace `minimumReleaseAge` + audit baseline of 112 inherited advisories
- Follow-ups for later waves:
  - W9: disable `allowScriptedContent` (apps/reader/src/models/reader.ts:366); use `@flow/epubjs`; pane as fifth SplitView child; Valtio store; raise root TS to 5.9.3 + fix 3 Flow errors + `allowImportingTsExtensions` before importing @illus/* (audit §11)
  - W2: separate Dexie 4.4.6 db `illus`; rewrite `/auth/chatgpt/*` → `/api/auth/chatgpt/*` with `locale: false`; strict-mode JSON Schema adaptation still to do (ADR 0003)
  - W11: Docker build fails (unpinned turbo 2.x), never copies `public/`; `.env.local` leaks into build context; next-pwa caches `/auth/chatgpt/callback`; move two inline scripts in `_document.tsx`
  - W4: render Vega via `vega-interpreter` once approved
  - W7: Pyodide worker CSP comes from its own response headers
  - `.claude/worktrees/` is not gitignored (W0 to add on next amend)

## Checkpoint after wave 0 — 2026-10-09
- Approved by Shubham: contracts v1.0 frozen (incl. ADR 0003); ADR 0001 CSP exceptions; `vega-interpreter` 2.3.2 added to §19; tooling deps (`typedoc-plugin-markdown`, jsdom, `@testing-library/dom`, `@types/node`); ADR 0004 out-of-ownership edits and audit baseline.
- Deferred to before wave 2: Dropbox sync / remote-URL import, Next.js 12 advisories (ADR 0005), Flow's Sentry config.

## Wave 1 — 2026-10-09
- Agents: w1-book-index, w2-llm-store, w4-renderers, w10-quality (phase A). All four hit the account session rate limit mid-run and were resumed from their transcripts.
- Branches merged: W1 (6ff8026), W10 phase A (59cf92d), W2 (701e8e8; reported partial, merged in full by Shubham's decision), W4 (ab1e9f2). Lockfile regenerated after W2 and W4 conflicts.
- Gate: lint ✓ typecheck ✓ test ✓ (40/40 turbo tasks) e2e n.a. (package-level e2e reported green by W1 and W4: 1 + 63 Playwright tests, not in the gate yet)
- Known red outside the gate: `next build` of apps/reader fails since the W2 app wiring (needs TS 5.9.3 + Flow type fixes, `@types/node` ≥ 22 in apps/reader, `satisfies` removed from `@illus/core/src/schemas/llm.ts`). apps/reader has no typecheck script, so the gate does not see it.
- ADRs opened (all proposed): 0006-w1-structural-indexing-decisions, 0006-w10-grounding-validation-evals, 0006-w2-llm-server-entry-and-test-deps, 0007-w2-gateway-and-signin-decisions, 0006-render-input-and-element-ids (W4). Numbers collide; left as is because renumbering means editing owned files. File slugs disambiguate. From wave 2 the orchestrator assigns ADR numbers per agent.
- Decisions by Shubham this wave:
  - W2 merged in full; W0 fixes the app build in the amend task before wave 2 (TS 5.9.3, Flow type fixes, `allowImportingTsExtensions`, `@types/node` in apps/reader, `satisfies` rewrite; moved from W9, ADR needed) and adds an app build check to the gate.
  - VPS login: sign in with ChatGPT on the laptop, copy the encrypted token file to the VPS; VPS reachable over Tailscale only, with W11's own simple login gate. W11 writes the ADR amending §17.
  - W2 defaults accepted: 100 req / 5 h and 300 / day caps, 30 min plan-limit pause without reset time, dynamic client registration with `ILLUS_CHATGPT_CLIENT_ID` as optional override.
- Contract-change requests (pending Shubham, to apply via W0 amend):
  1. dependencies.md rows: `@vitest/browser-playwright` 4.1.11, `playwright` 1.63.0, `minisearch` 7.2.0, `jsdom` 30.1.1 (W1); `fake-indexeddb` 6.2.5 (W2); `vite` 8.3.1, `@types/react` 18.3.31, `@types/react-dom` 18.3.7, `@types/node` 24.13.6, React 18.0.0 dev/peer (W4).
  2. `packages/epubjs/types/rendition.ts` enum fails `erasableSyntaxOnly`; rename to `.d.ts` (W1 set `erasableSyntaxOnly: false` in book-index as a workaround; W9 will hit it).
  3. Optional `Block.matchText` (W1 recommends no change).
  4. Optional `TemplateSpec.dropElement?(props, path)` (W10).
  5. Add `@illus/llm/server` to lint entry points (W2).
  6. `VisualRecord.spec` holds `null` or the IR for IR kinds; layout in `VisualRecord.layout` (W4). Alternative: move DOM-free compilers to `@illus/core/compile` (W3).
  7. §10 wording: Mermaid ids are aliases mapped back to IR ids (W4).
  8. Linux visual baselines for @illus/render, and e2e in CI (W4).
- Open questions for Shubham:
  - W1: split-part titles from h5 text instead of "(part k)"? Caption-less images as figure blocks?
  - W10: accept ADR 0006-w10 rule choices (dropped element = warning; unknown endpoint = error for repair; >2 isolated nodes or duplicate labels = error; auto-remove unused participants; cascaded drops lower grounding score)? Move eval-mini sections into an EPUB under fixtures/books?
  - W4: zoom on ctrl/⌘+wheel (plain wheel scrolls)? Small LR graphs until the aspect-ratio retry? Fixed 400 px HTML fallback?
  - Deferred from wave 0: Dropbox sync / remote import, Next.js 12 advisories (ADR 0005), Flow's Sentry config.
- Follow-ups for later waves:
  - W3: `validate()` + `needsReextract()` flow; lexical fallback `buildLexicalIndex(...).search(q, { beforeOrdinal })`; client via `httpTransport()`; `LlmResult.model/effort` into records and cache keys.
  - W5: implement `RenderTemplate` and `checkInvariants`; `onReady` from an effect; root `data-illus-frame="self"`; pass registry to `createIllusServer({ templates })`.
  - W6: issues with layer `animation` via `addIssues`; tokens are `[data-token-id]` overlays, edge paths via `[data-target="edge:<id>"] path`.
  - W8: `layoutGraph` with `hints`.
  - W9: `getSectionAt` + resolve `mergedInto`; `findQuote` for quote→CFI; katex CSS in `_app.tsx`; transpile list for render deps; `z.config({ jitless: true })` at startup; wire evidence callbacks and persist `onLayout`.
  - W10 phase B: `exportPng` for the critic; wait for `data-ready="true"`; verify synthetic `sectionId`s in evals/cases against W1's indexer.
  - W11: auth rewrite has no `locale: false` (it 404s in Next 12.3.4 with i18n), so the middleware matcher must cover `/auth/chatgpt/*` and `/<locale>/auth/chatgpt/*`; harden `createSessions`; next-pwa must not cache `/auth/` or `/api/`; 60/min rate limit on `/api/llm`; CSP header on `/illus-sandbox.html` without `frame-ancestors 'self'`.
  - All: `pnpm e2e` needs `pnpm exec playwright install chromium` once.
