// The whole-book run (ADR 0057): the concept pass first, then every section in reading order through
// the shared section jobs, `BOOK_RUN_SECTIONS` at a time, as background requests. Cache-first jobs make
// a cached section cost nothing, so resuming simply walks the book again. Pure and DOM-free.
import type { SectionNode } from '@illus/core'
import type { ConceptPass } from '@illus/concepts'

import type { Pipeline, SectionJob } from './pipeline.ts'

/** Sections in flight at once during a whole-book run. */
export const BOOK_RUN_SECTIONS = 2
/** Rough requests per uncached section: planner + ~2 items × (extractor + animator). Shown as "about". */
export const REQUESTS_PER_SECTION = 5
/** Sections in a row that may fail on `upstream` or `timeout` before the run pauses itself. */
export const MAX_FAILED_IN_A_ROW = 3
/** Errors that fail every later request too: the run pauses at the first one. */
const STOP_CODES = new Set(['signin-required', 'auth'])
/** Errors the gateway already retried: a few sections in a row means the server or network is down. */
const TRANSIENT_CODES = new Set(['upstream', 'timeout'])

export type BookRunStatus =
  | 'understanding'
  | 'illustrating'
  | 'paused'
  | 'paused-limit'
  | 'done'

export interface BookRunProgress {
  /** `paused` before the first `start()`. */
  status: BookRunStatus
  /** Target sections (`bookRunTargets`). */
  total: number
  /** Target sections whose job reached `done` this run (cached ones count, instantly). */
  finished: number
  noVisual: number
  failedItems: number
  /** Section ids. */
  inProgress: string[]
  /** The concept pass's result, once `understanding` is over. */
  indexed?: { indexed: number; total: number }
  /** Set with `paused-limit` when the plan limit's reset is known. */
  retryAfterMs?: number
  /**
   * Set with `paused` when the run paused itself: sign-in failed, `MAX_FAILED_IN_A_ROW` sections failed
   * on a transient error, or the concept pass stopped on an error. Absent when the user paused it.
   */
  stoppedBy?: { code: string; message: string }
}

export interface BookRun {
  /** Idempotent while running. */
  start(): Promise<BookRunProgress>
  /** Releases its handles (and pauses the concept pass); resolves `start()` with `paused`. */
  pause(): void
  /** A snapshot. */
  readonly progress: BookRunProgress
}

export interface BookRunDeps {
  pipeline: Pick<Pipeline, 'requestSection'>
  /** `pause`, when given, lets `pause()` stop the concept pass too. */
  concepts: Pick<ConceptPass, 'start'> & Partial<Pick<ConceptPass, 'pause'>>
  sections: readonly SectionNode[]
  /**
   * The section being read (ADR 0057 decision 3): the run takes targets in reading order from it,
   * then wraps around to the earlier ones. Default: the first section.
   */
  startAt?: string
  /** Sections in flight (default `BOOK_RUN_SECTIONS`). */
  concurrency?: number
  onProgress?(p: BookRunProgress): void
}

/** Sections a run illustrates: not merged into another, with at least one block, in reading order. */
export function bookRunTargets(
  sections: readonly SectionNode[],
): SectionNode[] {
  return sections
    .filter((s) => !s.mergedInto && s.blockIds.length > 0)
    .sort((a, b) => a.ordinal - b.ordinal)
}

/** About how many requests a run makes: `REQUESTS_PER_SECTION` per uncached section plus the indexing. */
export function estimateBookRun(o: {
  uncachedSections: number
  indexRequests: number
}): number {
  return (
    Math.max(0, o.uncachedSections) * REQUESTS_PER_SECTION +
    Math.max(0, o.indexRequests)
  )
}

/** `targets` rotated to start at the first one at or after `startAt` in reading order. */
function fromCurrent(
  targets: readonly SectionNode[],
  sections: readonly SectionNode[],
  startAt: string | undefined,
): SectionNode[] {
  const current = sections.find((s) => s.sectionId === startAt)
  const i = current
    ? targets.findIndex((s) => s.ordinal >= current.ordinal)
    : -1
  return i <= 0 ? [...targets] : [...targets.slice(i), ...targets.slice(0, i)]
}

export function createBookRun(deps: BookRunDeps): BookRun {
  const { pipeline, concepts } = deps
  const targets = bookRunTargets(deps.sections)
  const order = fromCurrent(targets, deps.sections, deps.startAt)
  const concurrency = Math.max(
    1,
    Math.floor(deps.concurrency ?? BOOK_RUN_SECTIONS),
  )
  let state: BookRunProgress = fresh('paused')
  let running: Promise<BookRunProgress> | null = null
  /** Why this run stops taking sections; reset by each `start()`. */
  let halt = newHalt()
  const held = new Set<SectionJob>()

  /** Sections that just failed on a transient error, in completion order; any healthy section resets it. */
  let failedInARow = 0

  function newHalt(): {
    paused: boolean
    stopping: boolean
    limit: { retryAfterMs?: number } | null
    error: { code: string; message: string } | null
  } {
    return { paused: false, stopping: false, limit: null, error: null }
  }

  function fresh(status: BookRunStatus): BookRunProgress {
    return {
      status,
      total: targets.length,
      finished: 0,
      noVisual: 0,
      failedItems: 0,
      inProgress: [],
    }
  }

  const snapshot = (): BookRunProgress => ({
    ...state,
    inProgress: [...state.inProgress],
    ...(state.indexed && { indexed: { ...state.indexed } }),
    ...(state.stoppedBy && { stoppedBy: { ...state.stoppedBy } }),
  })

  function report() {
    deps.onProgress?.(snapshot())
  }

  function stop() {
    halt.stopping = true
    for (const h of [...held]) h.cancel()
  }

  function hitLimit(retryAfterMs: number | undefined) {
    halt.limit ??= retryAfterMs === undefined ? {} : { retryAfterMs }
    stop()
  }

  function hitError(e: { code: string; message: string }) {
    halt.error ??= { code: e.code, message: e.message }
    stop()
  }

  async function illustrate(section: SectionNode) {
    const h = pipeline.requestSection(section.sectionId, {
      background: true,
      keepOthers: true,
    })
    held.add(h)
    state.inProgress.push(section.sectionId)
    report()
    /** Something drew (or the planner said there is nothing to draw): the requests are getting through. */
    let healthy = false
    let transient: { code: string; message: string } | null = null
    // A section that could not plan counts as one failed item; its job still ends with `done`.
    const failed = (e: {
      code: string
      message: string
      retryAfterMs?: number
    }) => {
      if (e.code === 'plan-limit') return hitLimit(e.retryAfterMs)
      if (STOP_CODES.has(e.code)) return hitError(e)
      if (TRANSIENT_CODES.has(e.code)) transient = e
      state.failedItems++
      report()
    }
    const off = [
      h.on('no-visual', () => {
        healthy = true
        state.noVisual++
        report()
      }),
      h.on('item-ready', () => {
        healthy = true
      }),
      h.on('item-failed', failed),
      h.on('error', failed),
      h.on('done', ({ cancelled }) => {
        if (!cancelled) {
          state.finished++
          failedInARow = healthy || !transient ? 0 : failedInARow + 1
          if (transient && failedInARow >= MAX_FAILED_IN_A_ROW)
            hitError(transient)
        }
        state.inProgress = state.inProgress.filter(
          (id) => id !== section.sectionId,
        )
        report()
      }),
    ]
    try {
      await h.finished
    } finally {
      held.delete(h)
      for (const unsubscribe of off) unsubscribe()
    }
  }

  async function worker(queue: SectionNode[]) {
    while (!halt.stopping && queue.length) await illustrate(queue.shift()!)
  }

  function finish(
    status: BookRunStatus,
    o: {
      retryAfterMs?: number | undefined
      stoppedBy?: { code: string; message: string }
    } = {},
  ) {
    state.status = status
    state.inProgress = []
    if (o.retryAfterMs !== undefined) state.retryAfterMs = o.retryAfterMs
    if (o.stoppedBy) state.stoppedBy = o.stoppedBy
    report()
    return snapshot()
  }

  async function run(): Promise<BookRunProgress> {
    halt = newHalt()
    failedInARow = 0
    state = fresh('understanding')
    report()
    try {
      const pass = await concepts.start()
      state.indexed = { indexed: pass.indexed, total: pass.total }
      if (halt.paused) return finish('paused')
      if (pass.error?.code === 'plan-limit')
        return finish('paused-limit', { retryAfterMs: pass.error.retryAfterMs })
      if (
        pass.error &&
        (STOP_CODES.has(pass.error.code) ||
          pass.error.code === 'aborted' ||
          (!pass.done && TRANSIENT_CODES.has(pass.error.code)))
      )
        return finish('paused', {
          stoppedBy: { code: pass.error.code, message: pass.error.message },
        })
      // Schema errors leave partial context; an incomplete transient failure indicates an outage (ADR 0061).
      // An incomplete pass without an error stopped because it was paused (including going offline).
      if (!pass.done && !pass.error) return finish('paused')
    } catch (e) {
      finish('paused')
      throw e
    }

    state.status = 'illustrating'
    report()
    const queue = [...order]
    // Every worker settles before the run does, so a later `start()` never overlaps a leftover one.
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(concurrency, queue.length) }, () =>
        worker(queue).catch((e: unknown) => {
          stop()
          throw e
        }),
      ),
    )
    const thrown = results.find((r) => r.status === 'rejected')
    if (thrown) {
      finish('paused')
      throw thrown.reason
    }
    if (halt.limit)
      return finish('paused-limit', { retryAfterMs: halt.limit.retryAfterMs })
    if (halt.error && !halt.paused)
      return finish('paused', { stoppedBy: halt.error })
    return finish(halt.paused ? 'paused' : 'done')
  }

  const run$: BookRun = {
    start() {
      // A resume right after `pause()` waits for the paused run to settle, then starts a new one.
      if (running && halt.paused) return running.then(run$.start, run$.start)
      running ??= run().finally(() => (running = null))
      return running
    },
    pause() {
      if (
        halt.paused ||
        (state.status !== 'understanding' && state.status !== 'illustrating')
      )
        return
      halt.paused = true
      if (state.status === 'understanding') concepts.pause?.()
      stop()
    },
    get progress() {
      return snapshot()
    },
  }
  return run$
}
