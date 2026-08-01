# 0009 — `apps/reader` builds on TypeScript 5.9 and the gate checks it

- Status: accepted (Shubham moved this work from W9 to W0 after wave 1, 2026-10-09)
- Date: 2026-10-09
- Workstream: W0 (amend contracts); planned for W9 in flow-audit §11
- Spec sections: §4, §18, §19, §20

## Context

Since W2 wired `/api/llm` and `/auth/chatgpt/*` into `apps/reader`, `next build` failed on `main`, and the merge gate (`pnpm turbo run lint typecheck test`) did not notice because `apps/reader` had no `typecheck` script. The causes:

1. Next's type check ran Flow's root TypeScript 4.6.3 over `@illus` sources, which need TS ≥ 5.5 (Zod 4) and import with `.ts` extensions.
2. Two copies of the React types were loaded. `next/types` references `react-dom`; once W4 added `@types/react-dom` 18.3.7 to the store, that reference resolved to it and pulled in `@types/react` 18.3.31 next to Flow's 17.0.43, so every JSX component failed to type-check.
3. `apps/reader` had `@types/node` 17.0.22, older than the Node 22+ APIs that `@illus/llm/server` (now compiled inside the app) uses.
4. Next 12.3's SWC cannot parse `satisfies` (TS 4.9 syntax), used in `packages/illus-core/src/schemas/llm.ts`.
5. With TS 5, Flow's ESLint 8 parser (`@typescript-eslint/parser` 5.10.1, also pinned by `eslint-config-next` 12.1.5) drops decorators, so `next lint` reported `debounce` in `apps/reader/src/models/reader.ts` as unused.

## Decision

- **TypeScript 5.9.3** at the root and in `apps/reader` (devDependency, so `tsc` is the right one).
- **`apps/reader/tsconfig.json`**: `allowImportingTsExtensions: true` (`noEmit` is already set), `target: es2022` (type check only; Next compiles with SWC and its browserslist).
- **`apps/reader` types**: `@types/react` 18.3.31 and `@types/react-dom` 18.3.7 (one copy of the JSX types; React is already 18.0.0), `@types/node` 24.13.6.
- **Flow type fixes** (types only, no behaviour change), all in `apps/reader/src`: components that take `children` declare it (`React.FC<React.PropsWithChildren<…>>`, React 18 types dropped implicit `children`) in `components/Layout.tsx`, `components/Reader.tsx`, `components/base/DropZone.tsx`, `components/pages/settings.tsx`; `@literal-ui/core`'s `LiteralProvider` is cast to accept `children` in `pages/_app.tsx`; type-only imports under `isolatedModules` in `components/Layout.tsx` and `components/Theme.tsx`; three Valtio snapshot reads that hit TS2589 ("excessively deep") are cast to the model's own types in `components/Reader.tsx` and `components/viewlets/ImageView.tsx`. The `RenditionSpread` change (ADR 0008 item 2) also touches `state.ts`, `components/Reader.tsx` and `components/viewlets/TypographyView.tsx`.
- **`satisfies` removed**: `ROLES` is checked by an identity helper `checkRoles<T extends Record<RoleName, RoleSpec>>(roles: T): T`, which keeps the literal type. The shared `@illus` ESLint config bans `TSSatisfiesExpression` (tested in `tooling/eslint-config/test/boundaries.test.js`) until Next is upgraded (ADR 0005).
- **Flow's ESLint 8 stack**: `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin` 5.62.0 (2023-07-10, the last v5 release, supports ESLint 8.13), plus a pnpm override `"@typescript-eslint/parser@<6": 5.62.0` in `pnpm-workspace.yaml` so `eslint-config-next`'s own copy is lifted too. The `@illus` packages keep `typescript-eslint` 8.70.1.
- **Gate**: `apps/reader` gets `"typecheck": "tsc --noEmit -p ."`, so `pnpm turbo run lint typecheck test` type-checks the app (its `lint` was already `next lint`). CI adds `pnpm --filter @flow/reader build` after the turbo step, because only a real build sees what SWC cannot compile. Both run in replay mode with no secrets.

## Consequences

- `pnpm turbo run lint typecheck test` and `pnpm --filter @flow/reader build` pass on a clean checkout without `.env.local`.
- W9 no longer needs the toolchain step from flow-audit §11; it still adds each `@illus` package it imports to `next-transpile-modules` and must avoid TS syntax newer than SWC 12.3 understands (`satisfies`, `const` type parameters, `accessor`, `using`).
- The production build still runs `withSentryConfig`; W11 removes Sentry in wave 2 (flow-audit §12).
- The Next 15.5 migration after M1 (ADR 0005) can drop the `satisfies` ban, the override and the old ESLint stack.
