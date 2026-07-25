# 0002 — Package boundaries and the @illus toolchain

- Status: proposed (needs Shubham's approval)
- Date: 2026-10-09
- Workstream: W0
- Spec sections: §2 D11, §4, §19

## Context

§4 fixes the direction `core ← everything; store, llm, context ← pipeline, concepts; render, anim, tracer ← apps/reader`, but later sections need a few more edges: the trace view reuses template renderers (§12), the player renders visuals (§11), and W8's evolution scrubber and interactive layout live in `@illus/concepts/models` (§13, CLAUDE.md ownership). Flow's toolchain (TypeScript 4.6, ESLint 8, Prettier 2.6) cannot compile Zod 4 or run ESLint flat config. Flow vendors epub.js as `@flow/epubjs` instead of using the npm package.

## Decision

1. **Dependency matrix** enforced by `tooling/eslint-config` (`ALLOWED`):

   | Package | May import |
   | --- | --- |
   | core | — |
   | book-index | core, `@flow/epubjs` |
   | context, store, llm, render | core |
   | concepts | core, context, llm, store, render, anim |
   | pipeline | core, context, llm, store, concepts, book-index |
   | anim | core, render |
   | tracer | core, render, anim |
   | reader-bridge | core, `@flow/epubjs` |
   | evals | every `@illus` package |
   | apps/reader | anything (not linted by this config) |

   Nothing imports `apps/*`. Cross-package imports must hit `src/index.ts` (plus `@illus/core/testing` and `@illus/core/flags`); package-specifier deep imports are banned by `no-restricted-imports`. `@illus/core` and `@illus/context` ban browser globals.
2. **epub.js**: `@illus/book-index` and `@illus/reader-bridge` depend on the workspace package `@flow/epubjs` (0.3.93), not npm `epubjs`, so types and instances match Flow's.
3. **Toolchain per @illus package** (Flow keeps its own): TypeScript 5.9.3, ESLint 10.11.0 with `typescript-eslint` 8.70.1 and `eslint-plugin-boundaries` 7.2.0, Vitest 4.1.11. TS 6/7 are not used: `typescript-eslint` and TypeDoc support only up to 6.0, and TS 6 deprecates options Flow's base tsconfig uses.
4. **Source conventions**: relative imports carry `.ts` extensions (`allowImportingTsExtensions`), `erasableSyntaxOnly` and `verbatimModuleSyntax`. DOM-free code and scripts then run directly under Node 24's type stripping, with no build step and no `tsx`.
5. **Version policy**: the latest stable release at least 14 days old. If that release opens a major line less than about 4 weeks old, take the previous major's latest (Vitest 4.1.11 not 5.0.1; Mermaid 11.17.2 not 12.0.0). Enforced for transitive dependencies too with pnpm 10.34.5 `minimumReleaseAge: 20160` minutes.

## Consequences

- When W9 imports `@illus/*` into `apps/reader`, the root `typescript` must move to 5.9.3 (three small fixes in Flow code, listed in `docs/flow-audit.md` §11).
- A new edge in the matrix needs an ADR and an edit to `tooling/eslint-config/index.js`; the boundary tests (`tooling/eslint-config/test/boundaries.test.js`) prove the rules fire.
- Every package lists `eslint`, `typescript` and `vitest` itself, because the root `eslint` binary is Flow's ESLint 8.
