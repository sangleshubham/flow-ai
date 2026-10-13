// A concurrency limiter (§15 "Global limits") with two priority classes (ADR 0057). Tasks whose signal aborts while
// queued never start. Within one class the queue is FIFO; foreground tasks are picked before background ones.
// ponytail: plain two-class queue; switch to p-queue (approved, docs/dependencies.md) if more reordering is needed.
import { LlmError } from '@illus/core'
import type { LlmCall } from '@illus/core'

/** A reader-driven request is `foreground`; a whole-book run's request is `background`. */
export type Priority = 'foreground' | 'background'

export interface LimiterOptions {
  /** Most foreground tasks running at once (default: the total `concurrency`). */
  maxForeground?: number
  /** Most background tasks running at once (default: the total `concurrency`). */
  maxBackground?: number
}

export interface Limiter {
  /** `priority` is read each time the limiter picks a task, so a queued task can be promoted. Default: foreground. */
  run<T>(
    fn: () => Promise<T>,
    signal?: AbortSignal,
    priority?: () => Priority,
  ): Promise<T>
  /** Running tasks, for tests and the pane's usage line. */
  readonly active: number
  /** Running tasks that started as background, for tests. */
  readonly activeBackground: number
  readonly queued: number
  /** Re-evaluate the queue now. Call it after a queued task's priority changes while slots are free. */
  poke(): void
}

interface Entry {
  /** Starts the task as `cls`, its class at dequeue time. */
  start: (cls: Priority) => void
  priority: () => Priority
}

export function createLimiter(
  concurrency: number,
  opts: LimiterOptions = {},
): Limiter {
  const maxForeground = opts.maxForeground ?? concurrency
  const maxBackground = opts.maxBackground ?? concurrency
  let active = 0
  let activeForeground = 0
  let activeBackground = 0
  const queue: Entry[] = []

  const classOf = (e: Entry): Priority => {
    try {
      return e.priority() === 'background' ? 'background' : 'foreground'
    } catch {
      return 'foreground'
    }
  }

  const next = () => {
    while (active < concurrency && queue.length > 0) {
      // Priority is evaluated at dequeue time, so a job promoted while queued jumps the queue.
      const wantForeground = activeForeground < maxForeground
      const wantBackground = activeBackground < maxBackground
      let foreground = -1
      let background = -1
      // Scan oldest first and stop as soon as the class we prefer is found.
      for (let k = 0; k < queue.length; k++) {
        const cls = classOf(queue[k]!)
        if (cls === 'foreground' && wantForeground && foreground < 0)
          foreground = k
        else if (cls === 'background' && wantBackground && background < 0)
          background = k
        if (foreground >= 0 || (background >= 0 && !wantForeground)) break
      }
      const i = foreground >= 0 ? foreground : background
      if (i < 0) return
      const cls: Priority = foreground >= 0 ? 'foreground' : 'background'
      const [entry] = queue.splice(i, 1)
      entry!.start(cls)
    }
  }

  return {
    get active() {
      return active
    },
    get activeBackground() {
      return activeBackground
    },
    get queued() {
      return queue.length
    },
    poke: next,
    run(fn, signal, priority = () => 'foreground') {
      return new Promise((resolve, reject) => {
        const entry: Entry = {
          priority,
          start: (cls) => {
            signal?.removeEventListener('abort', onAbort)
            if (signal?.aborted) {
              reject(new LlmError('aborted', 'cancelled while queued'))
              return
            }
            active++
            if (cls === 'background') activeBackground++
            else activeForeground++
            const done = () => {
              active--
              if (cls === 'background') activeBackground--
              else activeForeground--
              next()
            }
            try {
              // Release the slot before settling, so a caller awaiting `run` sees the limiter already updated.
              fn().then(
                (v) => {
                  done()
                  resolve(v)
                },
                (e: unknown) => {
                  done()
                  reject(e)
                },
              )
            } catch (err) {
              done()
              reject(err)
            }
          },
        }
        const onAbort = () => {
          const i = queue.indexOf(entry)
          if (i >= 0) queue.splice(i, 1)
          reject(new LlmError('aborted', 'cancelled while queued'))
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        queue.push(entry)
        next()
      })
    },
  }
}

/**
 * An `LlmCall` whose calls go through `limiter` (§15). `priorityOf` maps a call's signal to its class at dequeue
 * time; without it every call is foreground.
 */
export function limitLlm(
  llm: LlmCall,
  limiter: Limiter,
  priorityOf?: (signal?: AbortSignal) => Priority,
): LlmCall {
  return {
    call: (role, ctx, opts) =>
      limiter.run(
        () => llm.call(role, ctx, opts),
        opts?.signal,
        () => priorityOf?.(opts?.signal) ?? 'foreground',
      ),
  }
}
