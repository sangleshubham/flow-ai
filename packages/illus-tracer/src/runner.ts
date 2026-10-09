import { RawTrace, ScenarioTrace, Translation, traceKey } from '@illus/core'
import type {
  IllusRepos,
  ReasoningEffort,
  TraceRunInput,
  TraceRunner,
} from '@illus/core'
import { compressTrace, MAX_TRACE_BYTES } from './compress.ts'

export const TRACER_VERSION = '1.0.0'
export interface TraceWorker {
  run(
    python: string,
    entry: string,
    focusFunctions: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<RawTrace>
}
export type TraceFixer = (
  translation: Translation,
  error: string,
  attempt: number,
) => Promise<Translation>
export type TraceFallbackRoute = 'timeline' | 'none' | 'simulated-template'
/** Structural discriminator allows the pipeline to route without importing a browser package. */
export class TraceFallbackError extends Error {
  readonly code = 'trace-fallback'
  readonly route: TraceFallbackRoute
  readonly reason: string
  readonly translation: Translation
  readonly repairs: number
  constructor(
    route: TraceFallbackRoute,
    reason: string,
    translation: Translation,
    repairs: number,
  ) {
    super(reason)
    this.name = 'TraceFallbackError'
    this.route = route
    this.reason = reason
    this.translation = translation
    this.repairs = repairs
  }
}
export interface TraceRunnerOptions {
  worker: TraceWorker
  fixer?: TraceFixer
}
const aborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Trace cancelled', 'AbortError')
}

export function createTraceRunner({
  worker,
  fixer,
}: TraceRunnerOptions): TraceRunner {
  return {
    async runTrace(input, opts) {
      let translation = Translation.parse(input.translation)
      for (let repairs = 0; repairs <= 2; repairs++) {
        aborted(opts?.signal)
        if (!translation.traceable) {
          const reason = translation.reason ?? 'This code is not traceable.'
          const concurrency =
            /concurren|goroutine|thread|async|distributed|channel/i.test(reason)
          throw new TraceFallbackError(
            concurrency ? 'timeline' : 'none',
            reason,
            translation,
            repairs,
          )
        }
        const scenarios: ScenarioTrace[] = []
        let failure: string | undefined
        for (const scenario of translation.scenarios) {
          aborted(opts?.signal)
          let raw: RawTrace
          try {
            raw = RawTrace.parse(
              await worker.run(
                translation.python,
                scenario.entry,
                translation.focusFunctions,
                opts,
              ),
            )
          } catch (error) {
            aborted(opts?.signal)
            if (error instanceof Error && error.name === 'AbortError')
              throw error
            failure = error instanceof Error ? error.message : String(error)
            break
          }
          if (raw.error) {
            failure = raw.error
            break
          }
          const unmapped = raw.steps.find(
            (s) =>
              s.pyLine > 0 &&
              !translation.lineMap.some((m) => m.py === s.pyLine),
          )
          if (unmapped) {
            failure = `Missing original line mapping for Python line ${unmapped.pyLine}`
            break
          }
          const mapped = {
            ...raw,
            steps: raw.steps.map((s) => ({
              ...s,
              origLines:
                translation.lineMap.find((m) => m.py === s.pyLine)?.orig ?? [],
            })),
          }
          const compressed = compressTrace(mapped)
          const stored = ScenarioTrace.parse({
            label: scenario.label,
            trace: {
              codeBlockId: input.codeBlockId,
              python: translation.python,
              lineMap: translation.lineMap,
              input: scenario.entry,
              assumptions: translation.assumptions,
              ...compressed,
            },
          })
          if (
            new TextEncoder().encode(JSON.stringify(stored)).length >
            MAX_TRACE_BYTES
          ) {
            failure = 'Complete scenario trace exceeds 2 MiB'
            break
          }
          scenarios.push(stored)
        }
        if (!failure) return scenarios
        if (!fixer || repairs === 2)
          throw new TraceFallbackError(
            'simulated-template',
            failure,
            translation,
            repairs,
          )
        aborted(opts?.signal)
        translation = Translation.parse(
          await fixer(translation, failure, repairs + 1),
        )
      }
      throw new Error('Unreachable trace repair limit')
    },
  }
}

export interface CachedTraceRunnerOptions extends TraceRunnerOptions {
  repos: Pick<IllusRepos, 'traces'>
  bookId: string
  codeSource: string
  translator: { promptVersion: string; model: string; effort: ReasoningEffort }
  now?: () => number
}
/** Optional repo adapter for consumers without the section pipeline's existing trace cache. */
export function createCachedTraceRunner(
  options: CachedTraceRunnerOptions,
): TraceRunner {
  const runner = createTraceRunner(options)
  return {
    async runTrace(input: TraceRunInput, opts) {
      aborted(opts?.signal)
      const cacheKey = await traceKey({
        codeSource: options.codeSource,
        translator: options.translator,
        tracerVersion: TRACER_VERSION,
      })
      const hit = await options.repos.traces.get(cacheKey)
      if (hit && !hit.stale)
        return hit.scenarios.map((s) => ({
          ...s,
          trace: { ...s.trace, codeBlockId: input.codeBlockId },
        }))
      const scenarios = await runner.runTrace(input, opts)
      // Successful repair code is carried by each scenario; retained Translation reflects that code.
      const first = scenarios[0]?.trace
      const translation = {
        ...input.translation,
        ...(first
          ? {
              python: first.python,
              lineMap: first.lineMap,
              assumptions: first.assumptions,
            }
          : {}),
      }
      await options.repos.traces.put({
        cacheKey,
        bookId: options.bookId,
        codeBlockId: input.codeBlockId,
        translation,
        scenarios,
        mode: 'executed',
        promptVersions: { translator: options.translator.promptVersion },
        models: { translator: options.translator.model },
        efforts: { translator: options.translator.effort },
        createdAt: (options.now ?? Date.now)(),
        stale: false,
      })
      return scenarios
    },
  }
}
