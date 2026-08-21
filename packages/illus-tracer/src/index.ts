// Public API of @illus/tracer. Owner: W7. Nothing else may be imported from outside this package.
export { createBrowserTraceWorker } from './browser-worker.ts'
export type {
  BrowserTraceWorker,
  BrowserTraceWorkerOptions,
} from './browser-worker.ts'
export { compressTrace, MAX_TRACE_BYTES, MAX_TRACE_STEPS } from './compress.ts'
export {
  createTraceRunner,
  createCachedTraceRunner,
  TraceFallbackError,
  TRACER_VERSION,
} from './runner.ts'
export type {
  TraceWorker,
  TraceFixer,
  TraceFallbackRoute,
  TraceRunnerOptions,
  CachedTraceRunnerOptions,
} from './runner.ts'
export { projectHint } from './projection.ts'
export type { TraceProjection } from './projection.ts'
export { TraceView } from './TraceView.tsx'
export type {
  TraceViewProps,
  TracePlaybackControlsProps,
} from './TraceView.tsx'
