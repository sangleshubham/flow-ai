import { make } from '@illus/core/testing'
import type {
  SectionJob,
  SectionJobEvent,
  SectionJobEvents,
} from '@illus/pipeline'
import { describe, expect, it, vi } from 'vitest'

import {
  bindJob,
  createDwell,
  createPaneState,
  DEFAULT_PREFERENCES,
  dwellDelay,
  dwellSecondsLeft,
  evidenceAction,
  parseDwellMs,
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
  it('waits 5 s by default and only for sections with nothing cached', () => {
    expect(DEFAULT_PREFERENCES.dwellMs).toBe(5000)
    expect(dwellDelay({ cachedPlan: false, dwellMs: 5000 })).toBe(5000)
    expect(dwellDelay({ cachedPlan: true, dwellMs: 5000 })).toBe(0)
    expect(dwellDelay({ cachedPlan: false, dwellMs: 0 })).toBe(0)
  })
  it('accepts only the offered delays from saved settings', () => {
    expect(parseDwellMs(undefined)).toBe(5000)
    expect(parseDwellMs('5000')).toBe(5000)
    expect(parseDwellMs(-1)).toBe(5000)
    expect(parseDwellMs(1234)).toBe(5000)
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
