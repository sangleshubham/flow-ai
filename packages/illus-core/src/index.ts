// Public API of @illus/core (contracts v1.0). Test factories and fakes live in `@illus/core/testing`.
export * from './schemas/index.ts'
export { sha256Hex } from './hash/index.ts'
export * from './ids/index.ts'
export * from './flags/index.ts'
export * from './cache-keys/index.ts'
export * from './repos/index.ts'

// Modules owned by other workstreams; each owner fills its own index.ts.
export * from './compile/index.ts'
export * from './anim/index.ts'
export * from './grounding/index.ts'
export * from './validate/index.ts'

/** Version of the published contracts (docs/contracts.md). */
export const CONTRACTS_VERSION = '1.0.0'
