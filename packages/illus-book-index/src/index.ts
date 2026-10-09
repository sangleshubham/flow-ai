// Public API of @illus/book-index (owner W1, spec §6 Phase A, §7 lexical index, §14 location → section).
export { indexBookStructure, runInSlices, SLICE_MS } from './index-book.ts'
export type { IdleScheduler, IndexOptions, IndexRepos, Progress } from './index-book.ts'
export { getSectionAt } from './locate.ts'
export { buildLexicalIndex } from './lexical.ts'
export type { LexicalHit, LexicalIndex, LexicalSearchOptions } from './lexical.ts'
export {
  INDEX_VERSION,
  normalizeText,
  normalizeCodeText,
  foldForMatch,
  estimateTokens,
  parseHeadingNumber,
  parseCaptionLabel,
  findTextualRefs,
} from './text.ts'
export { blockTextOfRange } from './walk.ts'
export { OVERSIZED_TOKENS, PART_TOKENS, TINY_TOKENS } from './build.ts'
