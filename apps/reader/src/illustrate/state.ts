import { resolveFlags } from '@illus/core'
import type {
  Flags,
  PlanItem,
  ReaderSelection,
  SectionNode,
  VisualRecord,
} from '@illus/core'
import type {
  BookRunProgress,
  ItemStage,
  ReviewHook,
  SectionCacheState,
  SectionJob,
  SectionRunState,
} from '@illus/pipeline'
import { proxy } from 'valtio'
import { z } from 'zod'

// Zod's compiled fast path uses new Function, which the strict production CSP forbids. The flag is read
// when a schema is built, so it is set here, before `PersistedBookRun`.
z.config({ jitless: true })

export const PANE_STATES = [
  'idle',
  'indexing-required',
  'waiting',
  'planning',
  'generating',
  'ready',
  'no-visual',
  'error',
  'plan-limit',
  'signin-required',
  'offline',
] as const
export type PaneStatus = typeof PANE_STATES[number]
export interface Preferences {
  enabled: boolean
  autoHighlight: boolean
  /** "Highlight passage while playing" (ADR 0052): mark each animation step's passage in the book. */
  highlightSteps: boolean
  diagramMode: 'static' | 'animated'
  speed: number
  reducedMotion: 'system' | 'on' | 'off'
  debugPrompts: boolean
  /** How long the reader must stay on a section before a new illustration is generated (ADR 0048). */
  dwellMs: number
  flags: Flags
}
export const DEFAULT_PREFERENCES: Preferences = {
  enabled: false,
  autoHighlight: true,
  highlightSteps: true,
  diagramMode: 'static',
  speed: 1,
  reducedMotion: 'system',
  debugPrompts: false,
  dwellMs: 2000,
  flags: resolveFlags(),
}

/** Delays offered in settings; 0 generates as soon as the section opens. */
export const DWELL_OPTIONS_MS = [0, 2000, 5000, 10000] as const
export const parseDwellMs = (value: unknown): number =>
  DWELL_OPTIONS_MS.includes(value as typeof DWELL_OPTIONS_MS[number])
    ? (value as number)
    : DEFAULT_PREFERENCES.dwellMs
/** Storage-only schema version for saved preferences (not part of `Preferences`). */
export const PREFS_VERSION = 2
/** ADR 0057: 5 s was the only default before v2, so a saved 5000 from v1 means "default" → 2000. */
export const migrateDwellMs = (saved: {
  dwellMs?: unknown
  prefsVersion?: unknown
}) =>
  (typeof saved.prefsVersion === 'number' ? saved.prefsVersion : 1) < 2 &&
  saved.dwellMs === 5000
    ? 2000
    : parseDwellMs(saved.dwellMs)
/** A section with a saved plan opens straight away (no model calls); a new one waits for the dwell. */
export const dwellDelay = (o: { cachedPlan: boolean; dwellMs: number }) =>
  o.cachedPlan ? 0 : Math.max(0, o.dwellMs)
export const dwellSecondsLeft = (until: number, now: number) =>
  Math.max(0, Math.ceil((until - now) / 1000))
/** One pending generation at a time: every page move restarts it, leaving the section cancels it. */
export function createDwell() {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  return {
    start(ms: number, fn: () => void) {
      cancel()
      timer = setTimeout(() => {
        timer = undefined
        fn()
      }, ms)
    },
    cancel,
  }
}
/**
 * The whole-book run as the pane shows it (ADR 0057, ADR 0064). `preparing`: the book is being opened,
 * indexed and its cache counted (see `preparing`). `confirm` is the card before a run starts.
 * `stopping`: a new run waits (bounded) for the previous one to settle. `error`: the book could not be
 * prepared; `message` says why and the runtime's `retryActivate` tries again.
 */
export type BookRunUiStatus =
  | 'preparing'
  | 'idle'
  | 'confirm'
  | 'stopping'
  | 'understanding'
  | 'illustrating'
  | 'paused'
  | 'paused-limit'
  | 'done'
  | 'error'
/**
 * The state contract for the whole-book UI (ADR 0064). Counts are always real: after a reload they
 * are derived from the current-key cache and the saved record, so `finished` is never 0 while
 * sections are cached.
 *
 * - `sections`: target section id → `SectionRunState` (`pending`, `running`, `done`, `cached`,
 *   `failed`, `no-visual`); empty until the book is prepared.
 * - `finished`: sections not `pending`/`running`; `total`: target sections.
 * - `cursor`: where Resume continues (the first unfinished section in the run's order), else null.
 * - ETA: `session.avgSectionMs` × sections still `pending` ÷ `BOOK_RUN_SECTIONS` in flight; `session`
 *   is this page load's run (cached sections excluded from `done` and the mean).
 */
export interface BookRunState {
  status: BookRunUiStatus
  /** Target sections (`bookRunTargets`). */
  total: number
  finished: number
  noVisual: number
  failedItems: number
  /** Section ids. */
  inProgress: string[]
  /** Sections whose current-key plan and visuals are cached, or that have nothing to draw. */
  cachedCount: number
  /** Requests, while `confirm`. */
  estimate: number | null
  /** Local pause deadline in epoch ms; never a verified ChatGPT reset time. Kept for persisted runs. */
  resetAt: number | null
  /** Concept-pass progress while `understanding`. */
  indexed: { indexed: number; total: number } | null
  /** Why the run stopped, cannot resume yet, or (with `error`) why the book could not be prepared. */
  message: string
  /** While `preparing`: the current step, with done/total when known. */
  preparing: { label: string; done?: number; total?: number } | null
  /** A confirm or start pressed before the book was ready; it happens once the book is ready. */
  queued: 'confirm' | 'start' | null
  /** Target section id → its state in the run (see above). */
  sections: Record<string, SectionRunState>
  /** The section Resume continues from; null without a saved run or once every section is finished. */
  cursor: string | null
  /** Epoch ms the saved run was first started (kept across reloads); null without one. */
  startedAt: number | null
  /** This page load's run: when it started, sections it finished with model calls, their mean time. */
  session: {
    startedAt: number
    done: number
    avgSectionMs: number | null
  } | null
}
export const createBookRunState = (): BookRunState => ({
  status: 'idle',
  total: 0,
  finished: 0,
  noVisual: 0,
  failedItems: 0,
  inProgress: [],
  cachedCount: 0,
  estimate: null,
  resetAt: null,
  indexed: null,
  message: '',
  preparing: null,
  queued: null,
  sections: {},
  cursor: null,
  startedAt: null,
  session: null,
})
/** Maps the run's progress onto the pane. `resetAt` is the runtime's (it asks the gateway). */
export function applyBookRunProgress(
  state: BookRunState,
  p: BookRunProgress,
): void {
  state.status = p.status
  state.total = p.total
  state.finished = p.finished
  state.noVisual = p.noVisual
  state.failedItems = p.failedItems
  state.inProgress = [...p.inProgress]
  state.sections = { ...p.sections }
  state.cursor = p.cursor ?? null
  if (p.startedAt !== undefined)
    state.session = {
      startedAt: p.startedAt,
      done: p.sessionDone,
      avgSectionMs: p.avgSectionMs ?? null,
    }
  if (p.indexed) state.indexed = { ...p.indexed }
  state.estimate = null
  if (p.status !== 'paused-limit') state.resetAt = null
  if (p.status === 'understanding' || p.status === 'illustrating')
    state.message = ''
}
/**
 * ADR 0064: counts and the per-section map from the cache (current keys only) and the saved record,
 * when the book opens or a run is stopped. Sections the saved run recorded as failed stay `failed`
 * until they are cached.
 */
export function bookRunFromCache(
  state: BookRunState,
  o: {
    targets: readonly string[]
    cache: ReadonlyMap<string, { state: SectionCacheState }>
    saved: PersistedBookRun | null
  },
): void {
  const failed = new Set(o.saved?.failed ?? [])
  const sections: Record<string, SectionRunState> = {}
  let cached = 0
  let noVisual = 0
  let finished = 0
  for (const id of o.targets) {
    const c = o.cache.get(id)?.state
    const s: SectionRunState =
      c === 'cached'
        ? 'cached'
        : c === 'no-visual'
        ? 'no-visual'
        : failed.has(id)
        ? 'failed'
        : 'pending'
    sections[id] = s
    if (s === 'cached') cached++
    if (s === 'no-visual') noVisual++
    if (s !== 'pending') finished++
  }
  state.total = o.targets.length
  state.sections = sections
  state.cachedCount = cached + noVisual
  state.noVisual = noVisual
  state.finished = finished
  state.inProgress = []
  state.failedItems = o.saved?.failedItems ?? 0
  state.cursor =
    o.saved?.cursor && o.targets.includes(o.saved.cursor)
      ? o.saved.cursor
      : null
  state.startedAt = o.saved?.startedAt ?? null
}
/** Why a run paused itself, for the bar (ADR 0057). Without a reason, the concept pass was stopped. */
export function bookRunStopMessage(stoppedBy?: {
  code: string
  message: string
}): string {
  if (!stoppedBy)
    return 'Understanding the book stopped before it finished. Resume to try again.'
  if (stoppedBy.code === 'signin-required' || stoppedBy.code === 'auth')
    return 'ChatGPT needs you to sign in again. Sign in, then resume.'
  return `Paused because requests keep failing (${stoppedBy.message}). Resume to try again.`
}
/** Storage version of a saved run (ADR 0064). Version 1 (no `v`) had only `status` and `resetAt`. */
export const BOOK_RUN_VERSION = 2
const SavedStatus = z.enum(['running', 'paused', 'paused-limit'])
const PersistedBookRunV2 = z.object({
  v: z.literal(BOOK_RUN_VERSION),
  status: SavedStatus,
  resetAt: z.number().optional(),
  /** The section to continue from (`BookRunState.cursor`). */
  cursor: z.string().min(1).optional(),
  /** Epoch ms of the run's first start. */
  startedAt: z.number().optional(),
  /** Sections the run finished as failed, so a reload shows them; retried on Resume. */
  failed: z.array(z.string().min(1)).max(100_000).optional(),
  failedItems: z.number().int().nonnegative().optional(),
})
/** Version 1, migrated on read; the next write stores version 2. */
const PersistedBookRunV1 = z
  .object({
    v: z.undefined().optional(),
    status: SavedStatus,
    resetAt: z.number().optional(),
  })
  .transform(
    ({ status, resetAt }): z.output<typeof PersistedBookRunV2> => ({
      v: BOOK_RUN_VERSION,
      status,
      ...(resetAt !== undefined && { resetAt }),
    }),
  )
/**
 * A book's run as saved in settings `bookRuns` (Flow book id → this). Stored settings are untrusted.
 * Rollback: builds before ADR 0064 parse `{ status, resetAt }` with a non-strict object schema, so they
 * read version 2 records too (the extra fields are dropped); no down-migration is needed.
 */
export const PersistedBookRun = z.union([
  PersistedBookRunV2,
  PersistedBookRunV1,
])
export type PersistedBookRun = z.output<typeof PersistedBookRunV2>
/**
 * Parses settings `bookRuns` and reports what reading it migrates, without writing anything (the dry
 * run). `migrated`: version 1 entries now read as version 2; `dropped`: malformed entries left out.
 */
export function migrateBookRuns(value: unknown): {
  runs: Record<string, PersistedBookRun>
  migrated: string[]
  dropped: string[]
} {
  const migrated: string[] = []
  const dropped: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { runs: {}, migrated, dropped }
  // `fromEntries` defines own properties, so a stored `__proto__` key stays an ordinary entry.
  const runs = Object.fromEntries(
    Object.entries(value).flatMap(([id, entry]) => {
      const parsed = PersistedBookRun.safeParse(entry)
      if (!parsed.success) {
        dropped.push(id)
        return []
      }
      if ((entry as { v?: unknown }).v === undefined) migrated.push(id)
      return [[id, parsed.data] as const]
    }),
  )
  return { runs, migrated, dropped }
}
/** Parses settings `bookRuns`, dropping anything malformed (one bad entry never hides the others). */
export function parseBookRuns(
  value: unknown,
): Record<string, PersistedBookRun> {
  return migrateBookRuns(value).runs
}

export interface PaneState {
  open: boolean
  pinned: boolean
  status: PaneStatus
  bookId: string | null
  section: SectionNode | null
  items: PlanItem[]
  records: VisualRecord[]
  /**
   * Plan item → validated visual still being animated or reviewed (ADR 0054). Shown until its
   * `item-ready`; never stored, pinned or reported, so it stays out of `records`.
   */
  previews: Record<string, VisualRecord>
  selectedItem: string
  reason: string
  message: string
  announcement: string
  progress: string
  selection: ReaderSelection | null
  previousSectionId: string | null
  indexingApproved: boolean
  estimate: { requests: number; tokens: number } | null
  usage: {
    used5h: number
    usedDay: number
    pausedUntil: number | null
  } | null
  account: string
  /** False when the server has no ChatGPT sign-in configured (`/auth/chatgpt/status` → `configured: false`). */
  signinConfigured: boolean
  signedIn: boolean
  /** Plan item → sections being caught up by the concept model (§13 step 3), while it lasts. */
  catchingUp: Record<string, number>
  /** Plan item → latest pipeline stage while it generates. */
  stages: Record<string, ItemStage>
  /** `plan.overview`, shown under "About this section". */
  overview: string
  /** While `waiting`: when generation starts (epoch ms). */
  dwellUntil: number
  preferences: Preferences
  /** The open book's whole-book run (ADR 0057). */
  bookRun: BookRunState
  /** Flow book ids whose saved run is `running`: the runtime stays alive for them with the pane closed. */
  runningBooks: string[]
}
export function createPaneState(): PaneState {
  return {
    open: false,
    pinned: false,
    status: 'idle',
    bookId: null,
    section: null,
    items: [],
    records: [],
    previews: {},
    selectedItem: '',
    reason: '',
    message: '',
    announcement: '',
    progress: '',
    selection: null,
    previousSectionId: null,
    indexingApproved: false,
    estimate: null,
    usage: null,
    account: '',
    signedIn: false,
    signinConfigured: true,
    catchingUp: {},
    stages: {},
    overview: '',
    dwellUntil: 0,
    preferences: { ...DEFAULT_PREFERENCES, flags: resolveFlags() },
    bookRun: createBookRunState(),
    runningBooks: [],
  }
}
export const pane = proxy(createPaneState())

/** Subscribers attach synchronously; the pipeline schedules its first work in a microtask. */
export function bindJob(
  state: PaneState,
  job: SectionJob,
  current: () => boolean,
  refreshUsage: () => void,
): () => void {
  const guarded =
    <T>(cb: (v: T) => void) =>
    (v: T) => {
      if (current()) cb(v)
    }
  state.status = 'planning'
  state.message = ''
  state.reason = ''
  state.catchingUp = {}
  state.stages = {}
  state.overview = ''
  state.previews = {}
  const dropPreview = (planItemId: string) => {
    if (!(planItemId in state.previews)) return
    const rest = { ...state.previews }
    delete rest[planItemId]
    state.previews = rest
  }
  /** ADR 0065: a stale fallback visual of this item goes, so it never stands in for the new item. */
  const dropStale = (planItemId: string) => {
    if (state.records.some((r) => r.stale && r.planItemId === planItemId))
      state.records = state.records.filter(
        (r) => !(r.stale && r.planItemId === planItemId),
      )
  }
  const caughtUp = (planItemId: string) => {
    const rest = { ...state.catchingUp }
    delete rest[planItemId]
    state.catchingUp = rest
  }
  const error = ({ code, message }: { code: string; message: string }) => {
    state.status =
      code === 'plan-limit'
        ? 'plan-limit'
        : code === 'signin-required'
        ? 'signin-required'
        : 'error'
    state.message = message
    state.announcement = message
    refreshUsage()
  }
  const cleanups = [
    job.on(
      'plan',
      guarded(({ plan }) => {
        // ADR 0065: plan item ids are reused across planner versions. A stale fallback visual stays
        // only while the fresh plan has the same item (id, intent and kind) it was shown under.
        const before = new Map(state.items.map((i) => [i.planItemId, i]))
        state.records = state.records.filter((r) => {
          if (!r.stale) return true
          const was = before.get(r.planItemId)
          const now = plan.items.find((i) => i.planItemId === r.planItemId)
          return (
            !!was && !!now && was.intent === now.intent && was.kind === now.kind
          )
        })
        state.items = plan.items
        state.overview = plan.overview ?? ''
        state.selectedItem = plan.items[0]?.planItemId ?? ''
        state.status = plan.needsVisual ? 'generating' : 'no-visual'
        state.reason = plan.reason ?? ''
        state.announcement = plan.needsVisual
          ? 'Drawing this section.'
          : state.reason
      }),
    ),
    job.on(
      'item-progress',
      guarded((e) => {
        state.stages = { ...state.stages, [e.planItemId]: e.stage }
        if (e.stage === 'catching-up') {
          state.catchingUp = {
            ...state.catchingUp,
            [e.planItemId]: e.sections ?? 0,
          }
          state.announcement = catchUpText(e.sections ?? 0)
        } else if (e.planItemId in state.catchingUp) caughtUp(e.planItemId)
      }),
    ),
    job.on(
      'no-visual',
      guarded(({ reason }) => {
        state.status = 'no-visual'
        state.reason = reason
      }),
    ),
    job.on(
      'item-preview',
      guarded(({ planItemId, record }) => {
        state.previews = { ...state.previews, [planItemId]: record }
        if (state.status === 'generating') state.status = 'ready'
      }),
    ),
    job.on(
      'item-ready',
      guarded(({ record }) => {
        caughtUp(record.planItemId)
        dropPreview(record.planItemId)
        state.records = [
          ...state.records.filter((r) => r.planItemId !== record.planItemId),
          record,
        ]
        state.status = 'ready'
        state.announcement = `${
          state.items.find((i) => i.planItemId === record.planItemId)?.intent ??
          'Visual'
        } ready.`
        refreshUsage()
      }),
    ),
    job.on(
      'item-failed',
      guarded((e) => {
        caughtUp(e.planItemId)
        dropPreview(e.planItemId)
        // ADR 0065: a failed regeneration drops the item's stale visual. The plan limit and sign-in
        // block every request rather than fail this item, so the matching stale visual stays then.
        if (e.code !== 'plan-limit' && e.code !== 'signin-required')
          dropStale(e.planItemId)
        // Plan limit and sign-in block every item: show that state (cached visuals stay visible in it).
        if (
          !state.records.length ||
          e.code === 'plan-limit' ||
          e.code === 'signin-required'
        )
          error(e)
        else state.message = e.message
      }),
    ),
    job.on('error', guarded(error)),
    job.on(
      'done',
      guarded(() => {
        state.previews = {}
        // Every remaining item failed while cached visuals exist: show those instead of a skeleton forever.
        if (state.status === 'generating' && state.records.length)
          state.status = 'ready'
        refreshUsage()
      }),
    ),
  ]
  return () => cleanups.forEach((fn) => fn())
}

export const PLANNING_TEXT = 'Planning the visual…'
const STAGE_LABELS: Partial<Record<ItemStage, string>> = {
  extracting: 'Drawing the diagram…',
  retrying: 'Fixing the diagram…',
  escalating: 'Trying a stronger model…',
  animating: 'Adding animation…',
  critic: 'Checking the result…',
}
/** Human label for a stage; `cached` and internal stages have none. */
export const stageLabel = (stage: ItemStage | undefined): string | undefined =>
  stage && STAGE_LABELS[stage]

export const catchUpText = (sections: number) =>
  `Catching up the concept model: ${sections} ${
    sections === 1 ? 'section' : 'sections'
  }`

/** §16 L4/L5 review only while the `critic` flag is on (read per visual); otherwise the record is stored as extracted. */
export const whenCritic =
  (on: () => boolean, review: ReviewHook): ReviewHook =>
  (record, ctx) =>
    on() ? review(record, ctx) : Promise.resolve(record)

/**
 * What a highlight request does to the book. A clicked mark stays until another evidence is shown;
 * hover and focus marks are transient and only happen when auto-highlight is on.
 */
export function evidenceAction(o: {
  hasEvent: boolean
  click: boolean
  autoHighlight: boolean
  pinned: boolean
}): 'show' | 'clear' | 'ignore' {
  if (o.click) return o.hasEvent ? 'show' : 'clear'
  if (!o.autoHighlight) return 'ignore'
  if (!o.hasEvent) return o.pinned ? 'ignore' : 'clear'
  return 'show'
}
