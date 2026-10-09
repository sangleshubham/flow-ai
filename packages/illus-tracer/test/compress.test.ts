import { describe, expect, it } from 'vitest'
import type { TraceStep } from '@illus/core'
import { compressTrace } from '../src/compress.ts'

const step = (i: number, pyLine: number, depth = 1): TraceStep => ({
  i,
  event: 'line',
  pyLine,
  origLines: [],
  frames: Array.from({ length: depth }, () => ({ fn: 'f', locals: {} })),
  heap: {},
  stdout: '',
})
describe('trace compression', () => {
  it('keeps first three and last two loop iterations with skipped end state', () => {
    const steps = Array.from({ length: 10 }, (_, i) => [
      step(i * 2, 2),
      step(i * 2 + 1, 3),
    ]).flat()
    const out = compressTrace({ steps, truncated: false })
    expect(out.steps.map((s) => s.pyLine)).toEqual([
      2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3,
    ])
    expect(out.steps[6]?.skipped).toEqual({ iterations: 5 })
    expect(out.steps.map((s) => s.i)).toEqual(out.steps.map((_, i) => i))
  })
  it('collapses recursion below depth four and preserves return value', () => {
    const steps = [
      step(0, 1, 4),
      step(1, 1, 5),
      { ...step(2, 2, 5), event: 'return' as const, returnValue: { prim: 42 } },
      step(3, 3, 4),
    ]
    const out = compressTrace({ steps, truncated: false })
    expect(out.steps).toHaveLength(3)
    expect(out.steps[1]?.returnValue).toEqual({ prim: 42 })
    expect(out.steps[1]?.skipped).toBeDefined()
  })
  it('bounds steps and bytes while preserving final return', () => {
    const steps = Array.from({ length: 1000 }, (_, i) => ({
      ...step(i, i + 1),
      stdout: 'x'.repeat(4000),
    }))
    steps[999] = { ...steps[999]!, event: 'return', returnValue: { prim: 9 } }
    const out = compressTrace({ steps, truncated: false })
    expect(out.steps.length).toBeLessThanOrEqual(300)
    expect(
      new TextEncoder().encode(JSON.stringify(out)).length,
    ).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(out.steps.at(-1)?.returnValue).toEqual({ prim: 9 })
    expect(out.truncated).toBe(true)
  })
})
