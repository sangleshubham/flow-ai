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

## W0 amend (between waves 1 and 2) — 2026-10-09
- Agents: w0-foundation ("amend contracts", plus two follow-ups).
- Branches merged: W0 amend (9fb4e78, then d614740).
- Gate: lint ✓ typecheck ✓ test ✓ (43/43, fresh install) · `pnpm --filter @flow/reader build` ✓ · e2e n.a.
- Contracts: v1.0 → v1.2. Approved 1, 2, 4, 5, 6 (W4's proposal), 7. Rejected 3 (`Block.matchText`). Deferred 8 (Linux baselines + renderer tests in CI) to the final gate. v1.2: `code` blocks keep line breaks and indentation in `Block.text` (Shubham).
- App build: TS 5.9.3, Flow type fixes, apps/reader `typecheck` in the gate, `next build` in CI. On main the build had failed because the hoisted `@types/react` resolved to 17.0.43 or 18.3.31 depending on install order; now pinned workspace-wide to 18.3.31 / react-dom 18.3.7 via pnpm overrides (ADR 0009).
- ADRs: 0008-contracts-v1-1 (accepted), 0009-reader-build-on-typescript-5 (accepted), 0005 now accepted.
- Decisions (orchestrator, delegated by Shubham):
  - ADR 0005: next 12.3.7 + interim measures by W11; Tailscale-only; Next 15.5 migration after M1.
  - Flow's Dropbox sync, remote-URL import and Sentry are removed by W11 in wave 2.
  - W4's ctrl/⌘ wheel zoom, small LR graphs until retry, and fixed 400 px HTML fallback are accepted as built.
  - ADR 0006-w10's rule choices are accepted. The eval-mini EPUB is built at fixtures/books/eval/eval-mini.epub and stays there (Shubham).
- Decisions by Shubham: W1 split-part titles come from the sub-heading, and caption-less images become figure blocks (W1, wave 2).
- Open questions for Shubham: `apps/website` (Flow marketing site) gets 4 type errors under React 18 types; it is outside the gate and CI. Remove it, or have someone fix it? Align the `@types/react` pins in `packages/internal` and `apps/website` to 18.3.31?
- Follow-ups: W1 implements v1.2 code-block whitespace, bumps INDEX_VERSION, reverts `erasableSyntaxOnly: false`, tightens `fixtures/scripts/test/eval-mini.test.ts`. W11: CI now runs `next build`; Sentry's `withSentryConfig` is still in place until W11 removes it.

## Wave 2 — 2026-10-09
- Agents: w3-pipeline, w5-templates, w11-deploy-security, plus w1-book-index (v1.2 follow-ups) and w0-foundation (eval-mini test). All four wave agents hit the account session limit once and were resumed.
- Branches merged: W1 (3603510) with W0 (9cde423) in the same step; W5 (60217ec); W3 (0b403b0), gate red on synthetic.e2e after W1's index change, W3 re-keyed 8 replay fixtures (a917fc5, answers and assertions unchanged); W11 (b2bff5d).
- Gate: lint ✓ typecheck ✓ test ✓ (44/44) · `pnpm --filter @flow/reader build` ✓ · e2e n.a. (package-level e2e reported green: book-index 1/1, render templates 45/45 + W4 63/63, reader security 11/11 against `next start` and the Docker image)
- W3 reported "partial": the IR compilers belong to W4's @illus/render since ADR 0008; only `COMPILER_VERSION` is in @illus/core/compile. W3's own scope is done. W3 regenerated docs/contracts.md (generated file, +10 lines).
- W11 edited `createSessions` in @illus/llm/server (W2-owned) as its agent file assigns; backward compatible, W2's tests pass.
- ADRs opened (proposed): 0010-w3-context-concepts-pipeline-decisions, 0015-w5-template-library, 0020-w11-login-gate-and-deployment, 0025-w1-code-text-split-titles-captionless-figures.
- Contract-change requests (pending Shubham):
  1. W5 → W0: optional `TemplateSpec.targets?(props)` and `initialFrame?(props)` (W6 needs them).
  2. W5 → W0: `make.templateIR()` uses `pointers: { majority: 1 }`; should be `[{ name: 'majority', index: 1 }]`, evidence `pointers.0`.
  3. W5 → W10: `evals/replay/mini-stack.json`, `mini-bst.json` props don't match template schemas; `validate()` should catch `TemplateDropError` and keep the grounding error.
  4. W5 → W4: add the template visual suite to `pnpm e2e`; link templates README.
  5. W3, W11 → W4/W2: `fixtures/llm/html-fallback/*.json` use an old `{request, response}` shape; `fileFixtures()` throws, so any replay server loading `fixtures/llm` fails every `/api/llm` call. Must fix before W9 e2e.
  6. W11 → W0: dependencies.md (next 12.3.7; drop `@sentry/nextjs`, `dropbox`, `nookies`, `swr`; apps/reader uses vitest and @playwright/test); CI runs `pnpm --filter @flow/reader e2e`.
  7. W11: spec §9/§17 wording per ADR 0020; optional `rate-limit` code in `LlmResponse`.
  8. W1 → W0 (optional): caption-less image at the end of synthetic.epub §2.2, with W1 updating its snapshot in the same change.
- Open questions for Shubham:
  - W1: first part after an h5 split keeps the TOC title? Caption-less figures keep alt only in `figure.alt` (empty `text`)?
  - W5: hash-table resize and tree rotate shown as two visuals (no §11 op)? Stack top = last item? Visual baselines darwin only.
  - W3: accept ADR 0010 (no repair after failed escalation; version bump regenerates instead of showing stale)? Planner sees concept models only with the conceptModels flag? Default for `indexConfirmThresholdTokens`?
  - W11: accept password login (`ILLUS_LOGIN_PASSWORD`) as the VPS gate? Session cookie `Secure` on http://127.0.0.1?
  - Still open from the W0 amend: `apps/website` type errors (remove or fix?); align `@types/react` pins in packages/internal and apps/website.
  - Untracked `.agents/`, `.codex/` and a modified `AGENTS.md` appeared in the working tree, not from any agent; left uncommitted.
- Follow-ups for later waves:
  - W9: pass `templateRegistry` to VisualView, `validate` and `createIllusServer` only with the `templates` flag; subscribe right after `requestSection`; pass the concept pass and `buildLexicalIndex(...)`; `estimateIndexUsage` for the pre-index prompt; figure `cfiRange` may be a node CFI; use `blockTextOfRange(range, block.kind)`; expect small conflicts in Reader.tsx, index.tsx, settings.tsx, _app.tsx, _document.tsx; production-build e2e needs a session cookie (`apps/reader/e2e/env.ts`), dev uses `ILLUS_AUTH_GATE=off`.
  - W6: `validateAnimation(ir, animation)` for the pipeline; seed frames from `initialFrame`, targets from `targets`; containers `stack`/`queue`/`frames`/`order`; swap moves position contents.
  - W7: provide `traceRunner`; trace-fixer and simulated fallback not wired; Pyodide assets in `apps/reader/public/pyodide` (CSP already allows wasm).
  - W8: implement `ConceptModelRoute` and `conceptModelState` for packContext slot 7.
  - W10 phase B: `critic(record)` hook; repair loop to wire; fix the two template replay cases.
  - W4: property tests over random IR and a Vega-Lite schema check for compilers.
  - After any INDEX_VERSION, context-packer or W3 prompt version change: `pnpm --filter @illus/pipeline fixtures:llm`.
  - Flow's unused sync/remote-import i18n strings remain in locale files.

## Wave 3 prerequisites — 2026-10-09
- Approved by Shubham: commit the existing Codex agent setup, fix replay prerequisites and shared template contracts, then resume the build from wave 3.
- Setup: `4f845ee`; Node 24.20.0 selected from the existing local installation; pnpm 10.34.5. Added `.worktrees/` and generated `.pnpm-store/` ignores; existing Claude worktrees remain untouched.
- Agents: w0_foundation (amend contracts), w2_llm_store, w4_renderers, w10_quality (phase A test compatibility).
- Branches merged: W4 (`d1fde61`, then `04d12a8`), W10 (`33efa2e`, integrated into W0), W0 (`d4a28fa`), W2 (`eea5485`). Main integration head: `e25628d`.
- Contracts: v1.3; approved optional `TemplateSpec.targets` and `initialFrame` hooks; corrected array pointers and evidence paths in `make.templateIR()`. Validator and renderer test fixtures updated by their respective owners.
- Replay: both HTML fallback fixtures now conform to the established envelope; all 23 repository fixtures load. Reader launch resolves fixtures from the nearest workspace root; explicit `ILLUS_FIXTURES_DIR` overrides remain supported. Added full-directory server replay and fake-provider record-to-disk-to-replay regression coverage.
- Gate on merged main: lint ✓ typecheck ✓ test ✓ (44/44, forced uncached under Node 24); reader production build ✓. Owner browser checks: renderer 63/63, templates 45/45, production reader 11/11. No live model calls.
- CI: production reader Chromium tests added after the build; template browser suite included in the renderer e2e command. Linux renderer screenshot baselines remain deferred.
- ADRs opened: 0030-w0-wave3-contracts (accepted), 0031-w2-replay-fixture-resolution.
- Contract-change requests: none outstanding for these prerequisites.
- Follow-ups: standalone Docker replay/record requires mounted fixtures and `ILLUS_FIXTURES_DIR` (image excludes workspace manifests/fixtures). Vendored epub.js still masks its inherited lint errors; no lint rules or assertions were weakened.
