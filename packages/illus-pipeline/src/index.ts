// Public API of @illus/pipeline (§8, §15). Owner: W3. Nothing else may be imported from outside this package.
export {
  INDEX_WAIT_MS,
  MAX_BACKGROUND_LLM_REQUESTS,
  MAX_INSTRUCTION_CHARS,
  MAX_LLM_REQUESTS,
  MAX_LLM_REQUESTS_TOTAL,
  MAX_SECTIONS,
  createPipeline,
  kindEnabled,
  overrideKind,
  reportBlock,
  roleForKind,
  validateGraphSource,
} from './pipeline.ts'
export type {
  ConceptModelRoute,
  ItemStage,
  Pipeline,
  PipelineDeps,
  RequestOptions,
  ReviewHook,
  SectionJob,
  SectionJobEvent,
  SectionJobEvents,
} from './pipeline.ts'
export { createLimiter, limitLlm } from './limiter.ts'
export type { Limiter, LimiterOptions, Priority } from './limiter.ts'
export {
  BOOK_RUN_SECTIONS,
  MAX_FAILED_IN_A_ROW,
  REQUESTS_PER_SECTION,
  bookRunTargets,
  createBookRun,
  estimateBookRun,
} from './book-run.ts'
export type {
  BookRun,
  BookRunDeps,
  BookRunProgress,
  BookRunStatus,
} from './book-run.ts'
