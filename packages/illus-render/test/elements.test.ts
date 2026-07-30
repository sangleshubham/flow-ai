import { buildAllIRs, make, Q } from '@illus/core/testing'
import { describe, expect, it } from 'vitest'

import { elementFrame, evidenceIndex, irElements } from '../src/elements.ts'

describe('irElements', () => {
  it('lists every evidence-carrying element of every IR kind with a target', () => {
    for (const ir of buildAllIRs()) {
      const els = irElements(ir)
      if (ir.type === 'html') {
        expect(els).toEqual([])
        continue
      }
      expect(els.length).toBeGreaterThan(0)
      for (const e of els) expect(e.target).toBe(`${e.kind}:${e.id}`)
    }
  })

  it('uses the documented target scheme', () => {
    const ids = (ir: Parameters<typeof irElements>[0]) => irElements(ir).map((e) => e.target)
    expect(ids(make.graphIR())).toEqual(['node:client', 'node:leader', 'node:log', 'node:follower', 'edge:e1', 'edge:e2', 'edge:e3', 'edge:e4'])
    expect(ids(make.sequenceIR())).toEqual(['node:client', 'node:leader', 'node:follower', 'msg:m1', 'msg:m2', 'msg:m3'])
    expect(ids(make.stateIR())).toEqual(['node:follower', 'node:candidate', 'node:leader', 'edge:t1', 'edge:t2'])
    expect(ids(make.classIR())).toContain('item:Log.f0')
    expect(ids(make.classIR())).toContain('item:Log.m0')
    expect(ids(make.erIR())).toContain('item:logEntry.a1')
    expect(ids(make.chartIR())).toEqual(['item:series-0'])
    expect(ids(make.mathIR())).toEqual(['item:term-0'])
    expect(ids(make.timelineIR())).toEqual(['group:leader', 'group:follower', 'node:a1', 'node:a2', 'node:a3'])
    expect(ids(make.templateIR())).toEqual(['item:values', 'item:pointers.majority'])
  })

  it('indexes evidence by data-ir-id', () => {
    const idx = evidenceIndex(make.graphIR())
    expect(idx.get('e3')?.evidence).toEqual(Q.appendEntries)
    expect(idx.get('missing')).toBeUndefined()
  })
})

describe('elementFrame', () => {
  it('is neutral without a frame', () => {
    expect(elementFrame(undefined, 'node:a')).toEqual({ hidden: false, removed: false, pointers: [] })
  })

  it('reads hidden, removed, tone, value, annotation and pointers for one target', () => {
    const frame = make.frameState({
      hidden: ['node:follower'],
      removed: ['node:log'],
      highlights: { 'node:client': 'focus' },
      values: { 'node:client': 3 },
      annotations: { 'node:client': 'sends' },
      pointers: { i: 'node:client', j: 'node:client', k: 'node:leader' },
    })
    expect(elementFrame(frame, 'node:client')).toEqual({
      hidden: false,
      removed: false,
      tone: 'focus',
      value: 3,
      annotation: 'sends',
      pointers: ['i', 'j'],
    })
    expect(elementFrame(frame, 'node:follower').hidden).toBe(true)
    expect(elementFrame(frame, 'node:log').removed).toBe(true)
  })
})
