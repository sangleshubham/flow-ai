// Public API of @illus/concepts (§6 phase B). Owner: W3 (W8 owns `src/models` and adds its exports here).
export { acronymPairs, ambiguousGroups, canonicalName, clusterConcepts, nameKey, singular, toConcepts } from './cluster.ts'
export type { Cluster } from './cluster.ts'
export { GLOSSARY_EVERY, SUMMARY_AT, SUMMARY_BUDGET_TOKENS, bookContext, createConceptPass } from './pass.ts'
export type { ConceptPass, ConceptPassDeps, ConceptPassProgress, ConceptRepos } from './pass.ts'
export {
  BATCH_OVERHEAD_TOKENS,
  MAX_BATCH_SECTIONS,
  MAX_BATCH_TOKENS,
  NEAR_ORDINALS,
  estimateIndexUsage,
  planBatches,
  prioritize,
  takeBatch,
} from './queue.ts'
export type { IndexUsageEstimate } from './queue.ts'
