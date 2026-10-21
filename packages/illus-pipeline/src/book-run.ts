// The whole-book run (ADR 0057): the concept pass first, then every section in reading order through
// the shared section jobs, `BOOK_RUN_SECTIONS` at a time, as background requests. ADR 0064: sections
// whose current-key plan and visuals are cached count as finished from the first report and are never
// requested, and the progress carries a per-section map, a cursor to resume from and timing for an ETA.
// Pure and DOM-free.
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

/**
 * One target section in a run (ADR 0064): `pending` (not reached, or put back by a pause), `running`,
 * `done` (drawn with at least one model call this session), `cached` (nothing to do: cached before the
 * run, or the job was served from the cache), `failed` (an item or the plan failed) or `no-visual`.
 */
export type SectionRunState =
  | 'pending'
  | 'running'
  | 'done'
  | 'cached'
  | 'failed'
  | 'no-visual'

export interface BookRunProgress {
  /** `paused` before the first `start()`. */
  status: BookRunStatus
  /** Target sections (`bookRunTargets`). */
  total: number
  /** Target sections that are not `pending` or `running`: cached ones count from the first report. */
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
  /** Target section id → its state. Every target has an entry. */
  sections: Record<string, SectionRunState>
  /** The first `pending` or `running` section in the run's order: where a resume should start. Absent when none is left. */
  cursor?: string
  /** Epoch ms of this `start()` (a session); absent before the first one. */
  startedAt?: number
  /** Sections finished in this session that needed a model call (`done`, `failed`, or a fresh `no-visual`). */
  sessionDone: number
  /** Mean wall time, request to `done`, of those sections; absent until one finishes. */
  avgSectionMs?: number
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
  /**
   * `sectionCacheStatus`, when given, is checked at each `start()`: `cached` and `no-visual` sections are
   * finished at once and never requested (ADR 0064).
   */
  pipeline: Pick<Pipeline, 'requestSection'> &
    Partial<Pick<Pipeline, 'sectionCacheStatus'>>
  /** `pause`, when given, lets `pause()` stop the concept pass too. */
  concepts: Pick<ConceptPass, 'start'> & Partial<Pick<ConceptPass, 'pause'>>
  sections: readonly SectionNode[]
  /**
   * Where the run starts (ADR 0057 decision 3, ADR 0064): the run takes targets in reading order from
   * it, then wraps around to the earlier ones. A resume passes the saved `cursor`; a fresh run the
   * section being read. Default: the first section.
   */
  startAt?: string
  /** Sections in flight (default `BOOK_RUN_SECTIONS`). */
  concurrency?: number
  onProgress?(p: BookRunProgress): void
  now?: () => number
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
  const now = deps.now ?? Date.now
  let state: BookRunProgress = fresh('paused')
  /** Summed wall time of the `sessionDone` sections. */
  let sessionMs = 0
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
      sections: Object.fromEntries(
        targets.map((t) => [t.sectionId, 'pending' as SectionRunState]),
      ),
      sessionDone: 0,
    }
  }

  function cursor() {
    return order.find((t) => {
      const s = state.sections[t.sectionId]
      return s === 'pending' || s === 'running'
    })?.sectionId
  }

  const snapshot = (): BookRunProgress => {
    const at = cursor()
    return {
      ...state,
      inProgress: [...state.inProgress],
      sections: { ...state.sections },
      ...(at !== undefined && { cursor: at }),
      ...(state.indexed && { indexed: { ...state.indexed } }),
      ...(state.stoppedBy && { stoppedBy: { ...state.stoppedBy } }),
    }
  }

  /** Marks a section finished, once. */
  function settle(sectionId: string, to: SectionRunState) {
    state.sections[sectionId] = to
    state.finished++
    if (to === 'no-visual') state.noVisual++
  }

  /** ADR 0064: sections a default request would serve from the cache now. A failed check skips nothing. */
  async function markCached() {
    if (!pipeline.sectionCacheStatus) return
    let cache: Awaited<ReturnType<NonNullable<Pipeline['sectionCacheStatus']>>>
    try {
      cache = await pipeline.sectionCacheStatus(targets.map((t) => t.sectionId))
    } catch {
      return
    }
    for (const t of targets) {
      const c = cache.get(t.sectionId)?.state
      if (c === 'cached' || c === 'no-visual')
        settle(t.sectionId, c === 'cached' ? 'cached' : 'no-visual')
    }
  }

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
    const startedAt = now()
    held.add(h)
    state.inProgress.push(section.sectionId)
    state.sections[section.sectionId] = 'running'
    report()
    /** Something drew (or the planner said there is nothing to draw): the requests are getting through. */
    let healthy = false
    let transient: { code: string; message: string } | null = null
    /** ADR 0064: the section needed a model call (anything not served from the cache). */
    let worked = false
    let failedHere = false
    let noVisualHere = false
    // A section that could not plan counts as one failed item; its job still ends with `done`.
    const failed = (e: {
      code: string
      message: string
      retryAfterMs?: number
    }) => {
      if (e.code === 'plan-limit') return hitLimit(e.retryAfterMs)
      if (STOP_CODES.has(e.code)) return hitError(e)
      if (TRANSIENT_CODES.has(e.code)) transient = e
      worked = true
      failedHere = true
      state.failedItems++
      report()
    }
    const off = [
      h.on('plan', ({ fromCache }) => {
        if (!fromCache) worked = true
      }),
      h.on('no-visual', () => {
        healthy = true
        noVisualHere = true
      }),
      h.on('item-ready', ({ fromCache }) => {
        healthy = true
        if (!fromCache) worked = true
      }),
      h.on('item-failed', failed),
      h.on('error', failed),
      h.on('done', ({ cancelled }) => {
        if (cancelled) state.sections[section.sectionId] = 'pending'
        else {
          settle(
            section.sectionId,
            noVisualHere
              ? 'no-visual'
              : failedHere
              ? 'failed'
              : worked
              ? 'done'
              : 'cached',
          )
          if (worked) {
            sessionMs += now() - startedAt
            state.sessionDone++
            state.avgSectionMs = sessionMs / state.sessionDone
          }
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
      if (state.sections[section.sectionId] === 'running')
        state.sections[section.sectionId] = 'pending'
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
    for (const id of Object.keys(state.sections))
      if (state.sections[id] === 'running') state.sections[id] = 'pending'
    if (o.retryAfterMs !== undefined) state.retryAfterMs = o.retryAfterMs
    if (o.stoppedBy) state.stoppedBy = o.stoppedBy
    report()
    return snapshot()
  }

  async function run(): Promise<BookRunProgress> {
    halt = newHalt()
    failedInARow = 0
    sessionMs = 0
    state = fresh('understanding')
    state.startedAt = now()
    // The first report already counts what is cached, so a resumed run never shows 0 (ADR 0064).
    await markCached()
    if (halt.paused) return finish('paused')
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
    const queue = order.filter((t) => state.sections[t.sectionId] === 'pending')
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
