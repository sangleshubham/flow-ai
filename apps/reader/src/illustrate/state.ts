import { resolveFlags } from '@illus/core'
import type {
  Flags,
  PlanItem,
  ReaderSelection,
  SectionNode,
  VisualRecord,
} from '@illus/core'
import type { ItemStage, ReviewHook, SectionJob } from '@illus/pipeline'
import { proxy } from 'valtio'

export const PANE_STATES = [
  'idle',
  'indexing-required',
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
  speed: number
  reducedMotion: 'system' | 'on' | 'off'
  debugPrompts: boolean
  flags: Flags
}
export const DEFAULT_PREFERENCES: Preferences = {
  enabled: false,
  autoHighlight: true,
  speed: 1,
  reducedMotion: 'system',
  debugPrompts: false,
  flags: resolveFlags(),
}
export interface PaneState {
  open: boolean
  pinned: boolean
  status: PaneStatus
  bookId: string | null
  section: SectionNode | null
  items: PlanItem[]
  records: VisualRecord[]
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
    max5h: number
    maxDay: number
    pausedUntil: number | null
  } | null
  account: string
  /** False when the server has no ChatGPT sign-in configured (`/auth/chatgpt/status` → `configured: false`). */
  signinConfigured: boolean
  /** Plan item → sections being caught up by the concept model (§13 step 3), while it lasts. */
  catchingUp: Record<string, number>
  /** Plan item → latest pipeline stage while it generates. */
  stages: Record<string, ItemStage>
  /** `plan.overview`, shown above the item tabs. */
  overview: string
  preferences: Preferences
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
    signinConfigured: true,
    catchingUp: {},
    stages: {},
    overview: '',
    preferences: { ...DEFAULT_PREFERENCES, flags: resolveFlags() },
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
      'item-ready',
      guarded(({ record }) => {
        caughtUp(record.planItemId)
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
