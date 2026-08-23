import { releaseProxy, wrap } from 'comlink'
import type { Remote } from 'comlink'
import { RawTrace } from '@illus/core'
import type { TraceWorker } from './runner.ts'

interface WorkerApi {
  ready(): boolean
  run(python: string, entry: string, focusFunctions: string[]): RawTrace
}
export interface BrowserTraceWorkerOptions {
  workerUrl?: string
  timeoutMs?: number
  startupTimeoutMs?: number
  workerFactory?: (url: string) => Worker
}
export interface BrowserTraceWorker extends TraceWorker {
  dispose(): void
}

/** Serial main-thread owner. Startup has a separate timeout; user execution gets at most 3 s. */
export function createBrowserTraceWorker(
  options: BrowserTraceWorkerOptions = {},
): BrowserTraceWorker {
  let worker: Worker | undefined,
    remote: Remote<WorkerApi> | undefined,
    ready: Promise<unknown> | undefined
  let disposed = false
  let queue: Promise<unknown> = Promise.resolve()
  const reset = () => {
    remote?.[releaseProxy]()
    worker?.terminate()
    worker = undefined
    remote = undefined
    ready = undefined
  }
  function start() {
    if (!worker) {
      worker = (
        options.workerFactory ??
        ((url) => new Worker(url, { type: 'module', name: 'illus-trace' }))
      )(options.workerUrl ?? '/illus-trace-worker.mjs')
      remote = wrap<WorkerApi>(worker)
      ready = remote.ready()
    }
    return ready!
  }
  function limited<T>(
    work: Promise<T>,
    ms: number,
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
      }
      const abort = () => {
        done()
        reset()
        reject(new DOMException('Trace cancelled', 'AbortError'))
      }
      const timer = setTimeout(() => {
        done()
        reset()
        reject(new Error('timeout'))
      }, ms)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) {
        abort()
        return
      }
      work.then(
        (value) => {
          done()
          resolve(value)
        },
        (error) => {
          done()
          reset()
          reject(error)
        },
      )
    })
  }
  return {
    run(python, entry, focusFunctions, opts) {
      const run = queue.then(async () => {
        if (disposed) throw new Error('Trace worker disposed')
        if (opts?.signal?.aborted)
          throw new DOMException('Trace cancelled', 'AbortError')
        try {
          await limited(
            start(),
            options.startupTimeoutMs ?? 60_000,
            opts?.signal,
          )
          return RawTrace.parse(
            await limited(
              remote!.run(python, entry, focusFunctions),
              Math.min(options.timeoutMs ?? 3000, 3000),
              opts?.signal,
            ),
          )
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') throw error
          return {
            steps: [],
            truncated: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      })
      queue = run.catch(() => undefined)
      return run
    },
    dispose() {
      disposed = true
      reset()
    },
  }
}
