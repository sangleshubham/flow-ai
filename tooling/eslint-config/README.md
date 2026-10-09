# @illus/eslint-config

Shared ESLint 10 flat config for every `@illus/*` package (owner: W0). Flow's own code keeps its ESLint 8 `.eslintrc.js`; the two never meet because ESLint 10 only reads `eslint.config.js`.

## What it enforces

- `typescript-eslint` recommended rules, `consistent-type-imports`.
- **Package boundaries** (spec §4, ADR 0002) with `eslint-plugin-boundaries`:
  - the dependency matrix `ALLOWED` in `index.js` (`core` imports nothing; `render` only `core`; nothing imports `apps/*`; …);
  - cross-package imports must land on a public entry point (`src/index.ts`, plus `src/testing/index.ts` and `src/flags/index.ts` of core, and `src/server/index.ts` of llm = `@illus/llm/server`, ADR 0008);
  - `no-restricted-imports` bans package-specifier deep imports such as `@illus/core/src/ids`.
- Named exports only in `src/**/*.ts`.
- No `satisfies` in `src/**/*.{ts,tsx}`: Next 12's SWC compiles these sources inside `apps/reader` and cannot parse it (ADR 0009).
- `domFree`: bans browser globals (`window`, `document`, `indexedDB`, …) in `@illus/core` and `@illus/context`.

## Use

```js
// packages/illus-x/eslint.config.js
export { default } from '@illus/eslint-config'

// DOM-free packages
import config, { domFree } from '@illus/eslint-config'
export default [...config, ...domFree]
```

## Tests

`pnpm --filter @illus/eslint-config test` lints deliberate violations inside real packages and checks each one is reported (`test/boundaries.test.js`).
