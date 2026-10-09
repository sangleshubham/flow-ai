import { make } from '@illus/core/testing'
import type { SectionJob, SectionJobEvent, SectionJobEvents } from '@illus/pipeline'
import { describe, expect, it, vi } from 'vitest'

import { bindJob, createPaneState } from './state'

function jobFake() {
  const listeners = new Map<string, (value: never) => void>()
  const job: SectionJob = { sectionId: 'section', cancelled: false, cancel: vi.fn(), finished: Promise.resolve(), on(event, cb) { listeners.set(event, cb as (v: never) => void); return () => { listeners.delete(event) } } }
  return { job, emit<E extends SectionJobEvent>(event: E, data: SectionJobEvents[E]) { listeners.get(event)?.(data as never) } }
}
describe('pipeline subscription', () => {
  it('takes plan and cached results immediately and ignores detached jobs', () => {
    const s = createPaneState(); const fake = jobFake(); let current = true
    const detach = bindJob(s, fake.job, () => current, vi.fn())
    expect(s.status).toBe('planning')
    fake.emit('plan', { plan: make.visualPlan(), record: make.planRecord(), partialContext: false, fromCache: true })
    expect(s.status).toBe('generating')
    fake.emit('item-ready', { planItemId: 'item', record: make.visualRecord(), fromCache: true }); expect(s.status).toBe('ready')
    current = false; fake.emit('error', { code: 'upstream', message: 'stale error' }); expect(s.status).toBe('ready')
    detach()
  })
  it.each(['plan-limit', 'signin-required', 'upstream'])('maps %s failures to the pane state', (code) => {
    const s = createPaneState(); const fake = jobFake(); bindJob(s, fake.job, () => true, vi.fn())
    fake.emit('error', { code, message: 'Failure reason' }); expect(s.status).toBe(code === 'upstream' ? 'error' : code)
    expect(s.message).toBe('Failure reason')
  })
})
