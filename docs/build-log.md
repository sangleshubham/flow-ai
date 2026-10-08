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
