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
  it('collapses source loop iterations with differing branch lengths', () => {
    const python =
      'def f():\n  for i in range(10):\n    if i % 2:\n      x = 1\n    else:\n      x = 2\n  return x'
    const steps = Array.from({ length: 10 }, (_, i) => [
      step(i * 3, 2),
      step(i * 3 + 1, 3),
      step(i * 3 + 2, i % 2 ? 4 : 6),
    ]).flat()
    steps.push(step(30, 2), {
      ...step(31, 7),
      event: 'return',
      returnValue: { prim: 1 },
    })
    const out = compressTrace({ steps, truncated: false }, python)
    expect(out.steps.find((s) => s.skipped)?.skipped).toEqual({ iterations: 5 })
    expect(out.steps.filter((s) => s.pyLine === 2)).toHaveLength(6)
    expect(out.steps.at(-1)?.returnValue).toEqual({ prim: 1 })
  })
  it('caps even a single oversized untrusted snapshot', () => {
    const out = compressTrace({
      steps: [
        {
          ...step(0, 1),
          origLines: Array(1000000).fill(1),
          returnValue: { prim: 'x'.repeat(3000000) },
        },
      ],
      truncated: false,
      error: 'e'.repeat(3000000),
    })
    expect(
      new TextEncoder().encode(JSON.stringify(out)).length,
    ).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(out.truncated).toBe(true)
  })
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
