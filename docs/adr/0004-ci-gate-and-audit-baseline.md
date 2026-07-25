# 0004 — Making the merge gate runnable: Flow fixes and the audit baseline

- Status: proposed (needs Shubham's approval)
- Date: 2026-10-09
- Workstream: W0
- Spec sections: §17 (supply chain), §18, §20

## Context

The merge gate is `pnpm turbo run lint typecheck test` plus `pnpm audit` in CI. On Flow's `main` it could not pass:

- `next build` failed type-checking (`@flow/reader/locales`, from Flow commit `36f3cc7`);
- `@flow/epubjs`'s `test` script starts Karma with Chrome, so `turbo run test` fails in CI and locally;
- `pnpm audit` reports 283 advisories (18 critical, 136 high paths) in Flow's dependency tree: Next.js 12, webpack 4, Karma, and others;
- adding ESLint 10 to the workspace made pnpm resolve Flow's `@typescript-eslint/eslint-plugin` 5 peer to parser 8, breaking `next lint`.

Several of these touch files outside W0's ownership list (root `tsconfig.json`, `packages/epubjs/package.json`), which no workstream owns.

## Decision

1. Root `tsconfig.json`: map `@flow/reader/locales` to `apps/reader/locales` (one line; `next build` passes again on Node 24).
2. `packages/epubjs/package.json`: rename `test` to `test:karma` (run with `pnpm --filter @flow/epubjs test:karma`).
3. Root `devDependencies`: pin `@typescript-eslint/parser` 5.10.1, the version Flow already resolved, so Flow's ESLint 8 setup is unchanged. lint-staged runs Flow's ESLint only on Flow paths.
4. `pnpm-workspace.yaml` `auditConfig.ignoreGhsas`: the 112 high/critical GHSA ids present on 2026-10-09, all from Flow's tree and none from an `@illus` package. CI runs `pnpm audit --audit-level high`, so a **new** high or critical advisory fails the build. Moderate and low ones are reported, not blocking.

## Consequences

- The baseline hides known Flow advisories from `pnpm audit` output. The list is the record of that debt; remove entries as Flow dependencies are upgraded, starting with Next.js ([ADR 0005](0005-nextjs-12-security.md)).
- Anyone adding a dependency that brings a high or critical advisory must fix it or justify it in an ADR. Never just extend the list.
