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
  - W9: disable `allowScriptedContent` (apps/reader/src/models/reader.ts:366); use `@flow/epubjs`; pane as fifth SplitView child; Valtio store; raise root TS to 5.9.3 + fix 3 Flow errors + `allowImportingTsExtensions` before importing @illus/\* (audit §11)
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
  - W9: pass `templateRegistry` to VisualView, `validate` and `createIllusServer` only with the `templates` flag; subscribe right after `requestSection`; pass the concept pass and `buildLexicalIndex(...)`; `estimateIndexUsage` for the pre-index prompt; figure `cfiRange` may be a node CFI; use `blockTextOfRange(range, block.kind)`; expect small conflicts in Reader.tsx, index.tsx, settings.tsx, \_app.tsx, \_document.tsx; production-build e2e needs a session cookie (`apps/reader/e2e/env.ts`), dev uses `ILLUS_AUTH_GATE=off`.
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

## Wave 3 interrupted and resumed — 2026-10-09

- Account usage limit interrupted W3 integration, W7 tracer and W9 reader work; Shubham explicitly requested continuation after the reported reset time. Worktrees and uncommitted edits were preserved.
- Main remains at the completed prerequisite baseline (`86b4a9a` before this log entry). Feature work is isolated on `ws/w6-wave3`, `ws/w7-wave3`, `ws/w9-wave3`, `ws/w3-integration-wave3` and `ws/w11-assets-wave3`.
- W3 committed `e239243`: bounded trace repair and grounded simulated fallbacks, code-source whitelist checks and an animation validation context restricted to the packed blocks. Reported scoped gate: 20 tasks, 51 pipeline tests passed; exact browser fixture integration remains in progress.
- W11 committed `c2c4ab6`: worker CSP, Docker asset checks and replay fixture mounts/docs. Reported 55 unit tests and 11 existing production checks passed; two tracer integration tests and Docker verification await W7 assets and W9 build wiring.
- W6, W7 and W9 resumed from their saved edits. Wave 3 has not passed its integrated gate; no completion or live-model-quality claim is made.

## Wave 3 — 2026-10-09

- Agents: w6-animation, w7-tracer, w9-reader-ui, plus w3-pipeline (integration), w2-llm-store (template server), w4-renderers (server-safe template entry), w0-foundation (dependency notes), w11-deploy-security (tracer assets). Several runs stopped on usage limits or network errors (ENOTFOUND) and were resumed from saved work.
- Branches merged: W6 (40cf0af, e58808e), W3 (e6dc43c, 48452fb, 0ff7f97), W7 (a28b6f4), W4 (0c718d4), W0 (1ccb5cf), W11 (0f6e4d9), W2 (93fabc8, then the ADR 0041 follow-up), W9 (reader bridge + pane, then the e2e fix).
- Gate on merged main: lint ✓ typecheck ✓ test ✓ (44/44, forced) · e2e ✓ (5/5 tasks: reader 14/14, render 63 + 45, anim 7, tracer 2, book-index 1; replay mode) · reader production build ✓. No live model calls.
- ADRs: 0037-w3-wave3-integration (Figure 2.2 template replay), 0038-w11-tracer-assets, 0040 (W2: no server flag for template schema checks), 0041-w2-stale-template-fixture (resolved by W3).
- W2 touched `apps/reader/next.config.js` (transpile list only; headers untouched) and `apps/reader/tsconfig.json` (include d3-hierarchy.d.ts) so the reader builds with @illus/render.
- W9 fixed: Mermaid IR memoization (focus loss), evidence highlight policy (`evidenceAction`), bridge keeps evidence marks over step marks on the same CFI, replay mode skips `/auth/chatgpt/status`. The e2e asserts the real highlighted range and no 5xx responses.
- Contract-change requests: none outstanding.
- Decision by Shubham: the old W0 branch `worktree-agent-a5e3a28ba64188701` (ADR acceptances 0010/0015/0020/0025, apps/website removal, synthetic.epub caption-less image, spec §9/§17 per ADR 0020, CI reader e2e) is ported by W0 onto main after wave 3; W1, W3 and W10 re-key afterwards. Its contracts v1.3 and templateIR pointer commits are already on main.
- Cleanup pending (force-removing dirty worktrees was denied): stale `.worktrees/*` (w2-template-server, w3-integration, w9 hold uncommitted edits already committed on the merged agent branches) and `.claude/worktrees/agent-*` for merged agents.
- Follow-ups:
  - W2: `/auth/chatgpt/status` returns a 500 HTML page when sign-in is unconfigured; return JSON `{ configured: false }`.
  - W4: MermaidView redraws on new `ir` object identity (key on content?); Mermaid edges come before nodes in tab order and straight edges have zero-size boxes.
  - W5: add `/// <reference path="./d3-hierarchy.d.ts" />` in hierarchy.ts so the reader tsconfig include can go.
  - W3: regenerate browser fixtures with `ILLUS_BROWSER_REQUESTS=<capture> pnpm --filter @illus/pipeline fixtures:browser` (W9's e2e writes captures via `ILLUS_CAPTURE_PATH`).
  - Subagents with worktree isolation cannot run git in `.worktrees/*`; resume them in their own worktree.

## W0 port + synthetic.epub re-key (between waves 3 and 4) — 2026-10-09

- Agents: w0-foundation (port of the old W0 branch, per Shubham), then w1-book-index and w10-quality (phase A) in parallel, then w3-pipeline.
- Branches merged: W0 up to 9cd59cc (54bc4a5); then one merge carrying W0 41ec261 (epub), W1 98a2916 (snapshot + browser check for the caption-less figure), W10 2d517b2 (evals bookId) and W3 0e43080 (alt attribute in packed context, 20 synthetic + 1 browser fixture re-keyed).
- Gate: lint ✓ typecheck ✓ test ✓ (43/43 forced; apps/website removed) · e2e ✓ (reader 14/14, render 63 + 45, anim 7, tracer 2, book-index 1) · reader build ✓.
- Decisions (Shubham, recorded in ADRs 0010/0015/0020/0025, now accepted; ADR 0042 records the port): W1 split titles from TOC on the first part, caption-less alt only in `figure.alt`; W5 stack top = last item with a visible "top" marker, resize/rotate tried as one animation first, darwin-only baselines; W3 ADR 0010 as built, concept models only with the flag, `indexConfirmThresholdTokens` 200,000; W11 password gate, cookie `Secure` follows `ILLUS_PUBLIC_URL`; apps/website removed, @types/react pins aligned. All wave-2 open questions are closed.
- synthetic.epub bookId is now 9604b90977df58f0.
- Follow-ups: W5 visible stack "top" marker; W6 try resize/rotate as one animation; W9 threshold default 200,000; W10 phase B critic/repair/animator prompts treat a block's `alt` as info, never quotable evidence; `fixtures:browser` never removes stale keys (delete the old browser fixture after a bookId change); W0: `.husky/pre-commit` is not executable.

## Wave 4 — 2026-10-10

- Agents: w8-concept-models (2 attempts), w10-quality (phase B), plus w4-renderers (ELK fix for W8). Runs were interrupted by a network error (ENOTFOUND) and the account session limit and were resumed from saved work.
- Branches merged: W10 (1066de8), W4 (2b59cef: interactive ELK options on root and every group, semi-interactive crossing minimisation, `elk.position` hints), W8 (862335b).
- Gate on merged main: lint ✓ typecheck ✓ test ✓ (43/43) · e2e ✓ (reader 14, render 63 + 45, anim 7, tracer 2, book-index 1; replay mode). No live model calls.
- W8 displacement on the 5-section fixture (real ELK): per change 19.0 / 45.3 / 3.3 / 16.5 px, overall mean ≈ 19.8 px. Decision by Shubham: the ≤ 40 px target is the overall mean, so it is met.
- ADRs opened: 0043-w10-render-checks-critic-repair, 0044-w8-concept-models. Decision by Shubham: both accepted as built (W8 conservative defaults; W10 critic PNG at natural size capped 900 px @2×, render findings are warnings, trace/critic metrics measured in the reader, thumbs-down accepts the planned kind only).
- Replay eval report: evals/reports/2026-10-10.md (13 pass, 3 deliberate-fault fails, 24 private placeholders skipped).
- Contract-change requests (approved by Shubham as one wiring round before the final gate):
  1. W3: pass `createConceptModels(...).route` as `conceptModels` in `createPipeline`; replace the `critic(record)` hook with `review(record, …) => VisualRecord`; optional catch-up stage event; confirm W8's edits to illus-concepts package.json/tsconfig/README/index.ts.
  2. W9: render concept items from the model (`sectionView`, `conceptLayoutGraph`, `withLayout`), mount toggles and `EvolutionScrubber`; wire `criticHook` behind the `critic` flag with the warning badge.
  3. W4: add `e2e:check` to the render e2e chain; ELK fix comments cite ADR 0044 (not 0043).
  4. W0: dependencies.md (@illus/concepts test deps, evals runtime deps); allow `@illus/render/templates` in the no-deep-imports rule; note root `illus:export-feedback` script; make `.husky/pre-commit` executable.
  5. W2: confirm the gateway forwards `image` for the `critic` role.
- Open questions for Shubham: the 24 private eval placeholders need books, section ids and `mustInclude` terms; whether element labels reported wrong become `mustNotInclude`.
- Follow-ups: rerun `ILLUS_WRITE_FIXTURES=1 pnpm --filter @illus/concepts test` after context-packer or patcher prompt changes; critic/repair prompt changes need `ILLUS_WRITE_FIXTURES=1 pnpm --filter @illus/evals test quality-prompts`; `syn-2-2` eval case awaits W3's synthetic test passing the template registry.

## Wave 4 wiring round + final gate — 2026-10-10

- Agents: w0-foundation, w2-llm-store, w3-pipeline, w4-renderers, w10-quality, w9-reader-ui (contract-change requests 1–5 from wave 4). W9 was interrupted twice (usage limit, then ENOTFOUND) and resumed from saved work.
- Branches merged: W4 (5e9f0d8), W0 (6fa8639), W10 (d0e8d96, 30be5b5), W2 (02795ae), W3 (e1dbde5), W9 (d2f5749: concept-model view with toggles and EvolutionScrubber, `reviewHook` as `PipelineDeps.review` behind the `critic` flag, warning badge, catch-up progress, "sign-in not configured" state, 200,000-token index confirm threshold).
- Final gate on merged main: lint ✓ typecheck ✓ test ✓ (43/43, forced) · e2e ✓ (reader 14, render 63 + 45 + 3 check, anim 7, tracer 2, book-index 1; replay mode). No live model calls.
- §18 acceptance, replay mode:
  - CI green (lint, typecheck, unit, property, component, visual, integration, E2E): ✓
  - G2 `data-ir-id` + evidence click highlights the book: ✓ (reader e2e, render e2e)
  - G4 play/pause/step/scrub, reduced motion: ✓ on fixtures (anim e2e, Player tests); golden animated cases need a live eval.
  - G5 original-line highlight matches the line map: ✓ (tracer e2e); "≥ 80% of code cases execute for real" needs a live eval (replay report: 100% of 3).
  - G6 growing model, highlighted additions, out-of-order visits, displacement: ✓ (W8 tests; ≈ 19.8 px mean on the 5-section fixture).
  - G7 local caps and plan-limit 429 stop calls and show the plan-limit state: ✓ (gateway tests, reader e2e). Cache hit < 150 ms p50 in E2E timing: **not covered** — no e2e timing assertion exists.
  - G1, G3: need the live eval on the 40 golden sections (24 are private placeholders).
- ADRs opened: none.
- Contract-change requests: none outstanding.
- Open questions for Shubham:
  - W9: should §16 L4 render checks run on every visual, with the `critic` flag gating only L5? Today the whole review hook is behind `critic` (one-line change in W9's `state.ts`).
  - W9: the reader e2e seeds a concept model and critic report into IndexedDB because the synthetic book has no patcher/critic replay fixtures. Want hand-written ones (W8, W10) for a true end-to-end path?
  - Still open: books, section ids and `mustInclude` terms for the 24 private eval placeholders.
- Follow-ups: W9 add a cache-hit timing assertion (G7, < 150 ms p50) to the reader e2e; W4's wave-2 property tests and Vega-Lite schema check sit uncommitted in an old worktree (`agent-a3da9f440b4ee7afc`) and never reached main; one lint warning in @illus/pipeline.

## Hand-off — 2026-10-10

Only Shubham can do these:

1. Register the client for Sign in with ChatGPT and fill `.env.local` (`docs/setup-chatgpt-signin.md`).
2. Record live LLM fixtures with `ILLUS_LLM_MODE=record`.
3. Run `pnpm eval` live plus the effort sweep (§9 rules, §18 thresholds); add the private golden books first.
4. Deploy with `docs/deploy.md`.

## Fix round: richer visuals, wider context, no stuck sections (tasks.md) — 2026-10-10

- Trigger (Shubham, live mode): visuals basic with no animation, no whole-topic context (e.g. kinds of replication), planner text too short, sections stuck and slow.
- Agents: `fix-*` agents from `.claude/agents/`, one per task of `tasks.md`. Wave 1 ran T1–T5 in parallel, wave 2 ran T6 and T7, then T8. Worktrees were created from an old commit and reset to `main` before work started.
- Merged: T1 (W2: stream idle timeout; orchestrator raised the default to 180 s), T2 (W0: plan `overview`/`caption`, `planKey.kinds`, `templates`/`animations` default on), T3 (W6: `animationTargets`), T4 (W3: `subsections` context slot, `CONTEXT_VERSION` 2, summary at 10%, glossary every 15), T5 (W3: planner and extractor prompts 1.1.0, ADR 0045), T6 (W3: job signal on every call, stop on cancel, `<available_kinds>`, animator targets), T7 (W9: stage text, overview, captions), T8 (replay fixtures regenerated by script, READMEs).
- Gate: lint ✓ typecheck ✓ test ✓ (43/43, forced, on main) · e2e ✓ (reader 14 in T8's worktree, whose tree is identical to main; on main, the reader e2e web server could not build while `pnpm dev` held `apps/reader/.next`). No live model calls.
- ADR 0045 (accepted) also records abort-on-cancel, which changes §15.
- Follow-ups: no replay fixture covers a generated animator call (synthetic e2e pins `animations: false`). Saved preferences keep old `false` flags, so turn on Templates and Animations in Illustrate settings. Live check on a Replication chapter is still to do.
