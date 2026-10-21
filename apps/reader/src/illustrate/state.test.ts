import { make } from '@illus/core/testing'
import type {
  BookRunProgress,
  SectionJob,
  SectionJobEvent,
  SectionJobEvents,
} from '@illus/pipeline'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  applyBookRunProgress,
  bindJob,
  bookRunFromCache,
  bookRunStopMessage,
  createBookRunState,
  createDwell,
  createPaneState,
  DEFAULT_PREFERENCES,
  dwellDelay,
  dwellSecondsLeft,
  evidenceAction,
  migrateBookRuns,
  migrateDwellMs,
  parseBookRuns,
  parseDwellMs,
  PersistedBookRun,
  stageLabel,
  whenCritic,
} from './state'

function jobFake() {
  const listeners = new Map<string, (value: never) => void>()
  const job: SectionJob = {
    sectionId: 'section',
    cancelled: false,
    cancel: vi.fn(),
    finished: Promise.resolve(),
    on(event, cb) {
      listeners.set(event, cb as (v: never) => void)
      return () => {
        listeners.delete(event)
      }
    },
  }
  return {
    job,
    emit<E extends SectionJobEvent>(event: E, data: SectionJobEvents[E]) {
      listeners.get(event)?.(data as never)
    },
  }
}
describe('diagram view preferences', () => {
  it('defaults new preferences to static', () => {
    expect(DEFAULT_PREFERENCES.diagramMode).toBe('static')
    expect(createPaneState().preferences.diagramMode).toBe('static')
  })
})

describe('pipeline subscription', () => {
  it('takes plan and cached results immediately and ignores detached jobs', () => {
    const s = createPaneState()
    const fake = jobFake()
    let current = true
    const detach = bindJob(s, fake.job, () => current, vi.fn())
    expect(s.status).toBe('planning')
    fake.emit('plan', {
      plan: make.visualPlan(),
      record: make.planRecord(),
      partialContext: false,
      fromCache: true,
    })
    expect(s.status).toBe('generating')
    fake.emit('item-ready', {
      planItemId: 'item',
      record: make.visualRecord(),
      fromCache: true,
    })
    expect(s.status).toBe('ready')
    current = false
    fake.emit('error', { code: 'upstream', message: 'stale error' })
    expect(s.status).toBe('ready')
    detach()
  })
  it.each(['plan-limit', 'signin-required', 'upstream'])(
    'maps %s failures to the pane state',
    (code) => {
      const s = createPaneState()
      const fake = jobFake()
      bindJob(s, fake.job, () => true, vi.fn())
      fake.emit('error', { code, message: 'Failure reason' })
      expect(s.status).toBe(code === 'upstream' ? 'error' : code)
      expect(s.message).toBe('Failure reason')
    },
  )
})
describe('item failures with cached visuals', () => {
  it('keeps cached visuals ready after a failed regeneration and shows plan limits', () => {
    const s = createPaneState()
    s.records = [make.visualRecord()]
    const fake = jobFake()
    bindJob(s, fake.job, () => true, vi.fn())
    fake.emit('plan', {
      plan: make.visualPlan(),
      record: make.planRecord(),
      partialContext: false,
      fromCache: true,
    })
    fake.emit('item-failed', {
      planItemId: 'x',
      code: 'upstream',
      message: 'no fixture',
    })
    expect(s.status).toBe('generating')
    expect(s.message).toBe('no fixture')
    fake.emit('done', { cancelled: false })
    expect(s.status).toBe('ready')
    fake.emit('item-failed', {
      planItemId: 'x',
      code: 'plan-limit',
      message: 'paused',
    })
    expect(s.status).toBe('plan-limit')
  })
})
describe('item previews (ADR 0054)', () => {
  it('shows a preview while the item finishes, then the stored record replaces it', () => {
    const s = createPaneState()
    const fake = jobFake()
    bindJob(s, fake.job, () => true, vi.fn())
    fake.emit('plan', {
      plan: make.visualPlan(),
      record: make.planRecord(),
      partialContext: false,
      fromCache: false,
    })
    const preview = make.visualRecord({ planItemId: 'a' })
    fake.emit('item-preview', { planItemId: 'a', record: preview })
    expect(s.status).toBe('ready')
    expect(s.previews).toEqual({ a: preview })
    expect(s.records).toEqual([])
    const final = make.visualRecord({ planItemId: 'a', usageTokens: 99 })
    fake.emit('item-ready', {
      planItemId: 'a',
      record: final,
      fromCache: false,
    })
    expect(s.previews).toEqual({})
    expect(s.records).toEqual([final])
  })
  it('drops the preview when its item fails and clears leftovers when the job ends', () => {
    const s = createPaneState()
    const fake = jobFake()
    bindJob(s, fake.job, () => true, vi.fn())
    fake.emit('item-preview', {
      planItemId: 'a',
      record: make.visualRecord({ planItemId: 'a' }),
    })
    fake.emit('item-preview', {
      planItemId: 'b',
      record: make.visualRecord({ planItemId: 'b' }),
    })
    fake.emit('item-failed', {
      planItemId: 'a',
      code: 'upstream',
      message: 'x',
    })
    expect(Object.keys(s.previews)).toEqual(['b'])
    fake.emit('done', { cancelled: true })
    expect(s.previews).toEqual({})
  })
})
describe('concept-model catch-up', () => {
  it('tracks the catch-up stage per item until the item settles', () => {
    const s = createPaneState()
    const fake = jobFake()
    bindJob(s, fake.job, () => true, vi.fn())
    fake.emit('item-progress', {
      planItemId: 'a',
      stage: 'catching-up',
      sections: 2,
    })
    expect(s.catchingUp).toEqual({ a: 2 })
    expect(s.announcement).toBe('Catching up the concept model: 2 sections')
    fake.emit('item-progress', { planItemId: 'a', stage: 'patching' })
    expect(s.catchingUp).toEqual({})
    fake.emit('item-progress', {
      planItemId: 'b',
      stage: 'catching-up',
      sections: 1,
    })
    fake.emit('item-ready', {
      planItemId: 'b',
      record: make.visualRecord({ planItemId: 'b' }),
      fromCache: false,
    })
    expect(s.catchingUp).toEqual({})
  })
})
describe('critic gating', () => {
  it('runs W10 review only while the critic flag is on, read per visual', async () => {
    let on = false
    const reviewed = make.visualRecord({ planItemId: 'reviewed' })
    const review = vi.fn(async () => reviewed)
    const hook = whenCritic(() => on, review)
    const record = make.visualRecord()
    const ctx = {
      context: { prefix: '', body: '' },
      validation: {} as never,
      planItem: make.planItem(),
    }
    expect(await hook(record, ctx)).toBe(record)
    expect(review).not.toHaveBeenCalled()
    on = true
    expect(await hook(record, ctx)).toBe(reviewed)
    expect(review).toHaveBeenCalledOnce()
  })
})
describe('evidence highlight policy', () => {
  it('enables step highlights by default', () => {
    expect(DEFAULT_PREFERENCES.highlightSteps).toBe(true)
    expect(createPaneState().preferences.highlightSteps).toBe(true)
  })
  it('keeps a clicked mark through hover and focus loss, and ignores hover when auto-highlight is off', () => {
    expect(
      evidenceAction({
        hasEvent: true,
        click: true,
        autoHighlight: false,
        pinned: false,
      }),
    ).toBe('show')
    expect(
      evidenceAction({
        hasEvent: false,
        click: false,
        autoHighlight: true,
        pinned: true,
      }),
    ).toBe('ignore')
    expect(
      evidenceAction({
        hasEvent: false,
        click: false,
        autoHighlight: true,
        pinned: false,
      }),
    ).toBe('clear')
    expect(
      evidenceAction({
        hasEvent: true,
        click: false,
        autoHighlight: true,
        pinned: true,
      }),
    ).toBe('show')
    expect(
      evidenceAction({
        hasEvent: true,
        click: false,
        autoHighlight: false,
        pinned: false,
      }),
    ).toBe('ignore')
    expect(
      evidenceAction({
        hasEvent: false,
        click: false,
        autoHighlight: false,
        pinned: false,
      }),
    ).toBe('ignore')
  })
})
describe('generation stages', () => {
  it('stores the latest stage per item and labels it', () => {
    const s = createPaneState()
    const fake = jobFake()
    bindJob(s, fake.job, () => true, vi.fn())
    fake.emit('plan', {
      plan: make.visualPlan({ overview: 'Big picture' }),
      record: make.planRecord(),
      partialContext: false,
      fromCache: false,
    })
    expect(s.overview).toBe('Big picture')
    fake.emit('item-progress', { planItemId: 'x', stage: 'retrying' })
    fake.emit('item-progress', { planItemId: 'x', stage: 'critic' })
    expect(s.stages.x).toBe('critic')
    expect(stageLabel('retrying')).toBe('Fixing the diagram…')
    expect(stageLabel('cached')).toBeUndefined()
  })
})

describe('dwell before generating (ADR 0048)', () => {
  it('migrates a saved v1 default of 5 s to the new 2 s default (ADR 0057)', () => {
    expect(migrateDwellMs({ dwellMs: 5000 })).toBe(2000)
    expect(migrateDwellMs({ dwellMs: 5000, prefsVersion: 2 })).toBe(5000)
    expect(migrateDwellMs({ dwellMs: 10000 })).toBe(10000)
    expect(migrateDwellMs({ dwellMs: 0 })).toBe(0)
    expect(migrateDwellMs({ dwellMs: 'x', prefsVersion: 'y' })).toBe(2000)
    expect(migrateDwellMs({})).toBe(2000)
  })
  it('waits 2 s by default and only for sections with nothing cached', () => {
    expect(DEFAULT_PREFERENCES.dwellMs).toBe(2000)
    expect(dwellDelay({ cachedPlan: false, dwellMs: 2000 })).toBe(2000)
    expect(dwellDelay({ cachedPlan: false, dwellMs: 5000 })).toBe(5000)
    expect(dwellDelay({ cachedPlan: true, dwellMs: 5000 })).toBe(0)
    expect(dwellDelay({ cachedPlan: false, dwellMs: 0 })).toBe(0)
  })
  it('accepts only the offered delays from saved settings', () => {
    expect(parseDwellMs(undefined)).toBe(2000)
    expect(parseDwellMs('5000')).toBe(2000)
    expect(parseDwellMs(-1)).toBe(2000)
    expect(parseDwellMs(1234)).toBe(2000)
    for (const ms of [0, 2000, 5000, 10000]) expect(parseDwellMs(ms)).toBe(ms)
  })
  it('restarts on every move and fires once for the section the reader stays on', () => {
    vi.useFakeTimers()
    try {
      const dwell = createDwell()
      const first = vi.fn()
      const second = vi.fn()
      dwell.start(5000, first)
      vi.advanceTimersByTime(4000)
      dwell.start(5000, second)
      vi.advanceTimersByTime(4999)
      expect(first).not.toHaveBeenCalled()
      expect(second).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(second).toHaveBeenCalledOnce()
      expect(first).not.toHaveBeenCalled()
      const third = vi.fn()
      dwell.start(5000, third)
      dwell.cancel()
      vi.advanceTimersByTime(10_000)
      expect(third).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
  it('counts whole seconds down to zero', () => {
    expect(dwellSecondsLeft(10_000, 5_000)).toBe(5)
    expect(dwellSecondsLeft(10_000, 9_001)).toBe(1)
    expect(dwellSecondsLeft(10_000, 12_000)).toBe(0)
  })
})

describe('whole-book run state (ADR 0057)', () => {
  const progress = (o: Partial<BookRunProgress> = {}): BookRunProgress => ({
    status: 'illustrating',
    total: 12,
    finished: 3,
    noVisual: 1,
    failedItems: 2,
    inProgress: ['a', 'b'],
    sections: {},
    sessionDone: 0,
    ...o,
  })

  it('starts idle with nothing counted', () => {
    expect(createPaneState().bookRun).toEqual(createBookRunState())
    expect(createPaneState().runningBooks).toEqual([])
    expect(createBookRunState()).toMatchObject({
      status: 'idle',
      total: 0,
      cachedCount: 0,
      estimate: null,
      resetAt: null,
    })
  })

  it('maps the run progress onto the pane and keeps the cached count', () => {
    const s = { ...createBookRunState(), cachedCount: 4, estimate: 40 }
    const p = progress({ indexed: { indexed: 9, total: 12 } })
    applyBookRunProgress(s, p)
    expect(s).toMatchObject({
      status: 'illustrating',
      total: 12,
      finished: 3,
      noVisual: 1,
      failedItems: 2,
      inProgress: ['a', 'b'],
      indexed: { indexed: 9, total: 12 },
      cachedCount: 4,
      estimate: null,
    })
    // A copy, so the run's later snapshots never alias the pane's state.
    expect(s.inProgress).not.toBe(p.inProgress)
  })

  it('keeps a known reset time only while paused by the plan limit', () => {
    const s = { ...createBookRunState(), resetAt: 123, message: 'Stopped.' }
    applyBookRunProgress(s, progress({ status: 'paused-limit' }))
    expect(s.resetAt).toBe(123)
    expect(s.message).toBe('Stopped.')
    applyBookRunProgress(s, progress({ status: 'understanding' }))
    expect(s.resetAt).toBeNull()
    expect(s.message).toBe('')
  })

  it('accepts only the saved statuses', () => {
    expect(PersistedBookRun.safeParse({ status: 'running' }).success).toBe(true)
    expect(
      PersistedBookRun.safeParse({ status: 'paused-limit', resetAt: 5 })
        .success,
    ).toBe(true)
    for (const bad of [
      null,
      'running',
      { status: 'done' },
      { status: 'paused', resetAt: 'soon' },
    ])
      expect(PersistedBookRun.safeParse(bad).success).toBe(false)
  })

  it('drops malformed saved runs without hiding the valid ones', () => {
    expect(parseBookRuns(undefined)).toEqual({})
    expect(parseBookRuns('x')).toEqual({})
    expect(parseBookRuns([{ status: 'running' }])).toEqual({})
    const runs = parseBookRuns({
      a: { status: 'running' },
      b: { status: 'paused-limit', resetAt: 9 },
      c: { status: 'exploded' },
      d: 42,
      ['__proto__']: { status: 'paused' },
    })
    expect(Object.keys(runs).sort()).toEqual(['__proto__', 'a', 'b'])
    expect(runs.b).toEqual({ v: 2, status: 'paused-limit', resetAt: 9 })
    expect(Object.getPrototypeOf(runs)).toBe(Object.prototype)
  })
})

describe('resumable run state (ADR 0064)', () => {
  const progress = (o: Partial<BookRunProgress> = {}): BookRunProgress => ({
    status: 'illustrating',
    total: 4,
    finished: 2,
    noVisual: 0,
    failedItems: 0,
    inProgress: ['c'],
    sections: { a: 'cached', b: 'done', c: 'running', d: 'pending' },
    cursor: 'c',
    startedAt: 1_000,
    sessionDone: 1,
    avgSectionMs: 4_000,
    ...o,
  })

  it('maps the per-section map, the cursor and the session timing', () => {
    const s = createBookRunState()
    const p = progress()
    applyBookRunProgress(s, p)
    expect(s).toMatchObject({
      sections: { a: 'cached', b: 'done', c: 'running', d: 'pending' },
      cursor: 'c',
      session: { startedAt: 1_000, done: 1, avgSectionMs: 4_000 },
    })
    expect(s.sections).not.toBe(p.sections)
    applyBookRunProgress(
      s,
      progress({ cursor: undefined, avgSectionMs: undefined, sessionDone: 0 }),
    )
    expect(s.cursor).toBeNull()
    expect(s.session).toEqual({ startedAt: 1_000, done: 0, avgSectionMs: null })
  })

  it('derives counts from the current-key cache and the saved record, never 0 with cached sections', () => {
    const s = createBookRunState()
    bookRunFromCache(s, {
      targets: ['a', 'b', 'c', 'd', 'e'],
      cache: new Map([
        ['a', { state: 'cached' as const }],
        ['b', { state: 'no-visual' as const }],
        ['c', { state: 'partial' as const }],
        ['e', { state: 'missing' as const }],
      ]),
      saved: {
        v: 2,
        status: 'paused',
        cursor: 'c',
        startedAt: 5,
        failed: ['d', 'a'],
        failedItems: 3,
      },
    })
    expect(s).toMatchObject({
      total: 5,
      finished: 3,
      cachedCount: 2,
      noVisual: 1,
      failedItems: 3,
      cursor: 'c',
      startedAt: 5,
      sections: {
        a: 'cached',
        b: 'no-visual',
        c: 'pending',
        d: 'failed',
        e: 'pending',
      },
    })
    // A cursor that is no longer a target is ignored; no record means no run.
    bookRunFromCache(s, {
      targets: ['a'],
      cache: new Map(),
      saved: { v: 2, status: 'paused', cursor: 'gone' },
    })
    expect(s).toMatchObject({ cursor: null, finished: 0, failedItems: 0 })
    bookRunFromCache(s, { targets: ['a'], cache: new Map(), saved: null })
    expect(s.startedAt).toBeNull()
  })

  it('migrates version 1 records on read and reports it without writing (dry run)', () => {
    const stored = {
      old: { status: 'running' },
      limit: { status: 'paused-limit', resetAt: 9 },
      cur: {
        v: 2,
        status: 'paused',
        cursor: 's3',
        startedAt: 1,
        failed: ['x'],
      },
      future: { v: 3, status: 'paused' },
      bad: { v: 2, status: 'paused', cursor: 4 },
    }
    const before = structuredClone(stored)
    const r = migrateBookRuns(stored)
    expect(stored).toEqual(before)
    expect(r.migrated.sort()).toEqual(['limit', 'old'])
    expect(r.dropped.sort()).toEqual(['bad', 'future'])
    expect(r.runs).toEqual({
      old: { v: 2, status: 'running' },
      limit: { v: 2, status: 'paused-limit', resetAt: 9 },
      cur: {
        v: 2,
        status: 'paused',
        cursor: 's3',
        startedAt: 1,
        failed: ['x'],
      },
    })
    expect(parseBookRuns(stored)).toEqual(r.runs)
  })

  it('rollback: the schema of builds before ADR 0064 still reads a version 2 record', () => {
    const previous = z.object({
      status: z.enum(['running', 'paused', 'paused-limit']),
      resetAt: z.number().optional(),
    })
    expect(
      previous.parse({
        v: 2,
        status: 'paused-limit',
        resetAt: 7,
        cursor: 's3',
        startedAt: 1,
        failed: ['x'],
        failedItems: 1,
      }),
    ).toEqual({ status: 'paused-limit', resetAt: 7 })
  })
})

describe('bookRunStopMessage (ADR 0057)', () => {
  it('names the reason a run paused itself', () => {
    expect(bookRunStopMessage()).toBe(
      'Understanding the book stopped before it finished. Resume to try again.',
    )
    for (const code of ['signin-required', 'auth'])
      expect(bookRunStopMessage({ code, message: 'x' })).toBe(
        'ChatGPT needs you to sign in again. Sign in, then resume.',
      )
    expect(
      bookRunStopMessage({ code: 'upstream', message: 'network error' }),
    ).toBe(
      'Paused because requests keep failing (network error). Resume to try again.',
    )
  })
})
