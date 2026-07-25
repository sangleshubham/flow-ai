// Code tracer contracts (§12): the translator's output, the raw and stored traces, and trace records.
import { z } from 'zod'

import { ReasoningEffort, Timestamp } from './common.ts'
import { TemplateId } from './plan.ts'

/** Imports the translated Python may use (§12 translator rules). */
export const ALLOWED_PYTHON_IMPORTS = [
  'collections',
  'heapq',
  'bisect',
  'math',
  'itertools',
  'functools',
  'dataclasses',
  'typing',
  'string',
  'random',
] as const

/** Output of the `translator` and `trace-fixer` roles (§12). */
export const Translation = z.object({
  traceable: z.boolean(),
  reason: z.string().min(1).optional(),
  /** Stdlib only; imports limited to `ALLOWED_PYTHON_IMPORTS`. */
  python: z.string(),
  /** 1–2 scenarios, e.g. `{ label: 'found', entry: 'binary_search([1,3,5,7,9], 7)' }`. */
  scenarios: z
    .array(z.object({ label: z.string().min(1), entry: z.string().min(1) }))
    .min(1)
    .max(2),
  /** Why these inputs show the behaviour. */
  inputRationale: z.string(),
  /** Every executable Python line maps to ≥ 1 original line. */
  lineMap: z.array(
    z.object({
      py: z.number().int().positive(),
      orig: z.array(z.number().int().positive()).min(1),
    }),
  ),
  /** Traced line by line; other calls are stepped over. */
  focusFunctions: z.array(z.string().min(1)),
  vizHints: z.array(
    z.object({
      variable: z.string().min(1),
      fn: z.string().min(1).optional(),
      template: TemplateId,
      pointerOf: z.string().min(1).optional(),
    }),
  ),
  /** Semantic gaps between the original language and Python, always shown to the reader. */
  assumptions: z.array(z.string().min(1)),
})
export type Translation = z.infer<typeof Translation>

/** A primitive value or a reference into the step's heap (§12). */
export const ValueRef = z.union([
  z.object({ prim: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
  z.object({ ref: z.string().min(1) }),
])
export type ValueRef = z.infer<typeof ValueRef>

/** A heap object reachable from locals, identified by Python `id()` (§12). */
export const HeapObj = z.object({
  kind: z.enum(['list', 'tuple', 'dict', 'set', 'object']),
  cls: z.string().optional(),
  items: z.array(ValueRef).optional(),
  entries: z.array(z.tuple([ValueRef, ValueRef])).optional(),
  fields: z.record(z.string(), ValueRef).optional(),
  truncated: z.boolean().optional(),
})
export type HeapObj = z.infer<typeof HeapObj>

/** One recorded execution event (§12). Frames are innermost last. */
export const TraceStep = z.object({
  i: z.number().int().nonnegative(),
  event: z.enum(['line', 'call', 'return', 'exception']),
  pyLine: z.number().int().nonnegative(),
  origLines: z.array(z.number().int().positive()),
  frames: z.array(z.object({ fn: z.string(), locals: z.record(z.string(), ValueRef) })),
  heap: z.record(z.string(), HeapObj),
  stdout: z.string(),
  returnValue: ValueRef.optional(),
  exception: z.string().optional(),
  /** Synthetic step produced by compression. */
  skipped: z.object({ iterations: z.number().int().positive() }).optional(),
})
export type TraceStep = z.infer<typeof TraceStep>

/** What the trace worker returns for one run, before compression (§12 trace worker API). */
export const RawTrace = z.object({
  steps: z.array(TraceStep),
  /** Stopped at the 1,000 line-event limit. */
  truncated: z.boolean(),
  /** Exception message and traceback, or 'timeout' when the 3 s wall clock killed the worker. */
  error: z.string().optional(),
})
export type RawTrace = z.infer<typeof RawTrace>

/** A compressed, stored trace of one scenario (§5, §12). `input` is the scenario's entry call. */
export const Trace = z.object({
  codeBlockId: z.string().min(1),
  python: z.string(),
  lineMap: Translation.shape.lineMap,
  input: z.string(),
  assumptions: z.array(z.string()),
  steps: z.array(TraceStep),
  truncated: z.boolean(),
  error: z.string().optional(),
})
export type Trace = z.infer<typeof Trace>

/** A trace with the label of the scenario it ran (scenario tabs in the trace view). */
export const ScenarioTrace = z.object({ label: z.string().min(1), trace: Trace })
export type ScenarioTrace = z.infer<typeof ScenarioTrace>

/** Record of the `traces` store (§5), keyed by the trace cache key. */
export const TraceRecord = z.object({
  cacheKey: z.string().min(1),
  bookId: z.string().min(1),
  codeBlockId: z.string().min(1),
  translation: Translation,
  scenarios: z.array(ScenarioTrace),
  /** `executed` for real Pyodide runs; `simulated` for the animator fallback (§12 step 5). */
  mode: z.enum(['executed', 'simulated']),
  promptVersions: z.record(z.string(), z.string()),
  models: z.record(z.string(), z.string()),
  efforts: z.record(z.string(), ReasoningEffort),
  createdAt: Timestamp,
  stale: z.boolean(),
})
export type TraceRecord = z.infer<typeof TraceRecord>
