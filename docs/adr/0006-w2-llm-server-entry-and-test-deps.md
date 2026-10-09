# 0006 — `@illus/llm/server` entry point and the `fake-indexeddb` test dependency

- Status: proposed (needs Shubham's approval; W0 to update `docs/dependencies.md` and the lint entry points)
- Date: 2026-10-09
- Workstream: W2
- Spec sections: §4 (package rules), §9, §18, §19

## Context

1. §9 puts the `LlmProvider` interface in `@illus/llm` and the gateway, sign-in and token store on the
   Next.js server (`apps/reader/src/server/{llm,auth,usage}`). That server code needs `node:crypto`,
   `node:fs`, `openai` and `openid-client`, and it is the part most in need of tests. `apps/reader` has
   no test runner and type-checks with Flow's TypeScript 4.6, which cannot compile Zod 4.
2. `@illus/store` must prove its Dexie migrations and export/import round trip (W2 "done when"). Node
   has no IndexedDB, and jsdom does not provide one. §19 lists no IndexedDB fake.

## Decision

1. **Server half as a second entry point.** `@illus/llm` gets `exports["./server"]` →
   `src/server/index.ts` (gateway, OpenAI provider, Sign in with ChatGPT, token store, session cookie,
   usage caps, fixture files) plus a root `server.ts` shim so Flow's `moduleResolution: node` resolves
   it too. The main entry `@illus/llm` stays browser-safe (client, transports, model config, prompt
   registry, JSON Schema adapter, `LlmProvider` types). `apps/reader/src/server/*` keeps only
   environment wiring and Next.js adapters. Only `apps/reader` imports `@illus/llm/server` today; it
   is not linted by `tooling/eslint-config`.
   - **Request to W0:** add `src/server/index.ts` of `llm` to `ENTRY_POINTS` and allow
     `@illus/llm/server` in the `no-restricted-imports` pattern, so W10's eval harness (`evals/`) can
     drive the gateway directly for `pnpm eval`: a client transport is one line,
     `(req) => gateway.handle(req, { session: true }).then((r) => r.body)`.
2. **`fake-indexeddb` 6.2.5** (published 2025-11-07, Apache-2.0) as a **devDependency of
   `@illus/store` only**, used by Vitest to run Dexie against an in-memory IndexedDB. It never ships in
   the app bundle.
   - **Request to W0:** record it in `docs/dependencies.md` under "Development and test tooling".

## Consequences

- `docs/contracts.md` is unaffected (no `@illus/core` change).
- If the request in 1 is declined, `evals/` must call `/api/llm` over HTTP instead.
- If the request in 2 is declined, the store's Dexie tests (migrations, parity with the in-memory
  fakes, export/import, eviction) cannot run in CI; they would move to Playwright in a real browser.
