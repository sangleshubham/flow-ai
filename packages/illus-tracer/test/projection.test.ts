import { describe, expect, it } from 'vitest'
import { make } from '@illus/core/testing'
import { projectHint } from '../src/projection.ts'

describe('heap to template projections', () => {
  it('maps array pointers and preserves primitive values', () => {
    const s = make.traceStep({
      frames: [{ fn: 'search', locals: { a: { ref: '1' }, lo: { prim: 1 } } }],
      heap: { '1': { kind: 'list', items: [{ prim: 2 }, { prim: 4 }] } },
    })
    expect(
      projectHint(s, { variable: 'a', template: 'array' }, [
        { variable: 'lo', template: 'array', pointerOf: 'a' },
      ])?.props,
    ).toEqual({
      label: 'a',
      values: [2, 4],
      pointers: [{ name: 'lo', index: 1 }],
    })
  })
  it('maps linked objects by Python identity including a cycle', () => {
    const s = make.traceStep({
      frames: [{ fn: 'reverse', locals: { head: { ref: '10' } } }],
      heap: {
        '10': {
          kind: 'object',
          fields: { value: { prim: 1 }, next: { ref: '20' } },
        },
        '20': {
          kind: 'object',
          fields: { value: { prim: 2 }, next: { ref: '10' } },
        },
      },
    })
    expect(
      projectHint(s, { variable: 'head', template: 'linked-list' })?.props,
    ).toEqual({
      label: 'head',
      nodes: [
        { id: 'p10', value: 1 },
        { id: 'p20', value: 2 },
      ],
      head: 'p10',
      cycleTo: 'p10',
      pointers: [],
    })
  })
  it('maps a nested list DP table to a grid', () => {
    const s = make.traceStep({
      frames: [{ fn: 'dp', locals: { dp: { ref: '1' } } }],
      heap: {
        '1': { kind: 'list', items: [{ ref: '2' }, { ref: '3' }] },
        '2': { kind: 'list', items: [{ prim: 1 }, { prim: 2 }] },
        '3': { kind: 'list', items: [{ prim: 3 }, { prim: 4 }] },
      },
    })
    expect(projectHint(s, { variable: 'dp', template: 'grid' })?.props).toEqual(
      {
        label: 'dp',
        rows: 2,
        cols: 2,
        cells: [
          [1, 2],
          [3, 4],
        ],
      },
    )
  })
  it('does not invent a structure when the requested variable is absent', () => {
    expect(
      projectHint(make.traceStep(), { variable: 'missing', template: 'array' }),
    ).toBeUndefined()
  })
})
