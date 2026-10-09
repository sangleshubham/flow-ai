import { resolveFlags } from '@illus/core'
import type { Flags, PlanItem, ReaderSelection, SectionNode, VisualRecord } from '@illus/core'
import type { SectionJob } from '@illus/pipeline'
import { proxy } from 'valtio'

export const PANE_STATES = ['idle', 'indexing-required', 'planning', 'generating', 'ready', 'no-visual', 'error', 'plan-limit', 'signin-required', 'offline'] as const
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
  enabled: false, autoHighlight: true, speed: 1, reducedMotion: 'system', debugPrompts: false, flags: resolveFlags(),
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
  usage: { used5h: number; usedDay: number; max5h: number; maxDay: number; pausedUntil: number | null } | null
  account: string
  preferences: Preferences
}
export function createPaneState(): PaneState {
  return { open: false, pinned: false, status: 'idle', bookId: null, section: null, items: [], records: [], selectedItem: '',
    reason: '', message: '', announcement: '', progress: '', selection: null, previousSectionId: null,
    indexingApproved: false, estimate: null, usage: null, account: '', preferences: { ...DEFAULT_PREFERENCES, flags: resolveFlags() } }
}
export const pane = proxy(createPaneState())

/** Subscribers attach synchronously; the pipeline schedules its first work in a microtask. */
export function bindJob(state: PaneState, job: SectionJob, current: () => boolean, refreshUsage: () => void): () => void {
  const guarded = <T>(cb: (v: T) => void) => (v: T) => { if (current()) cb(v) }
  state.status = 'planning'; state.message = ''; state.reason = ''
  const error = ({ code, message }: { code: string; message: string }) => {
    state.status = code === 'plan-limit' ? 'plan-limit' : code === 'signin-required' ? 'signin-required' : 'error'
    state.message = message; state.announcement = message; refreshUsage()
  }
  const cleanups = [
    job.on('plan', guarded(({ plan }) => {
      state.items = plan.items; state.selectedItem = plan.items[0]?.planItemId ?? ''
      state.status = plan.needsVisual ? 'generating' : 'no-visual'
      state.reason = plan.reason ?? ''; state.announcement = plan.needsVisual ? 'Drawing this section.' : state.reason
    })),
    job.on('no-visual', guarded(({ reason }) => { state.status = 'no-visual'; state.reason = reason })),
    job.on('item-ready', guarded(({ record }) => {
      state.records = [...state.records.filter((r) => r.planItemId !== record.planItemId), record]
      state.status = 'ready'; state.announcement = `${state.items.find((i) => i.planItemId === record.planItemId)?.intent ?? 'Visual'} ready.`
      refreshUsage()
    })),
    job.on('item-failed', guarded((e) => {
      if (!state.records.length) error(e)
      else state.message = e.message
    })),
    job.on('error', guarded(error)),
    job.on('done', guarded(() => refreshUsage())),
  ]
  return () => cleanups.forEach((fn) => fn())
}
