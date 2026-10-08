import { make, Q } from '@illus/core/testing'
import { describe, expect, it } from 'vitest'

import { layoutTimeline, TL } from '../src/timeline/layout.ts'

describe('layoutTimeline', () => {
  it('puts each lane on its own row and orders events by `at`', () => {
    const l = layoutTimeline(make.timelineIR())
    expect(l.lanes.map((x) => x.id)).toEqual(['leader', 'follower'])
    expect(l.lanes[1]!.y - l.lanes[0]!.y).toBe(TL.laneH)
    const [a1, a2, a3] = l.events
    expect(a1!.x).toBeLessThan(a2!.x)
    expect(a2!.x).toBeLessThan(a3!.x)
    expect(a3!.y).toBe(l.lanes[1]!.y)
    expect(l.ticks.map((t) => t.at)).toEqual([0, 1, 2])
  })

  it('draws cross-lane messages as arrows to the target lane', () => {
    const l = layoutTimeline(make.timelineIR())
    const a2 = l.events.find((e) => e.id === 'a2')!
    expect(a2.arrow).toEqual({ x2: a2.x + TL.colW * 0.6, y2: l.lanes[1]!.y })
    expect(l.events.find((e) => e.id === 'a1')!.arrow).toBeUndefined()
  })

  it('shares one column between simultaneous events and skips events on unknown lanes', () => {
    const ir = make.timelineIR({
      events: [
        { id: 'x', lane: 'leader', at: 5, label: 'a', evidence: Q.append },
        { id: 'y', lane: 'follower', at: 5, label: 'b', evidence: Q.append },
        { id: 'z', lane: 'ghost', at: 6, label: 'c', evidence: Q.append },
      ],
    })
    const l = layoutTimeline(ir)
    expect(l.events.map((e) => e.id)).toEqual(['x', 'y'])
    expect(l.events[0]!.x).toBe(l.events[1]!.x)
    expect(l.width).toBeGreaterThan(TL.laneLabelW)
  })
})
