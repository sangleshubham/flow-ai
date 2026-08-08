// A FIFO concurrency limiter (§15 "Global limits"). Tasks whose signal aborts while queued never start.
// ponytail: plain FIFO, no priorities; switch to p-queue (approved, docs/dependencies.md) if items need reordering.
import { LlmError } from '@illus/core'
import type { LlmCall } from '@illus/core'

export interface Limiter {
  run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>
  /** Running tasks, for tests and the pane's usage line. */
  readonly active: number
  readonly queued: number
}

export function createLimiter(concurrency: number): Limiter {
  let active = 0
  const queue: (() => void)[] = []
  const next = () => {
    if (active >= concurrency) return
    const start = queue.shift()
    start?.()
  }
  return {
    get active() {
      return active
    },
    get queued() {
      return queue.length
    },
    run(fn, signal) {
      return new Promise((resolve, reject) => {
        const start = () => {
          signal?.removeEventListener('abort', onAbort)
          if (signal?.aborted) {
            reject(new LlmError('aborted', 'cancelled while queued'))
            next()
            return
          }
          active++
          fn()
            .then(resolve, reject)
            .finally(() => {
              active--
              next()
            })
        }
        const onAbort = () => {
          const i = queue.indexOf(start)
          if (i >= 0) queue.splice(i, 1)
          reject(new LlmError('aborted', 'cancelled while queued'))
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        queue.push(start)
        next()
      })
    },
  }
}

/** An `LlmCall` whose calls go through `limiter` (4 requests in flight, §15). */
export function limitLlm(llm: LlmCall, limiter: Limiter): LlmCall {
  return { call: (role, ctx, opts) => limiter.run(() => llm.call(role, ctx, opts), opts?.signal) }
}
