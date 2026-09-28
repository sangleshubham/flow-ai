import { describe, expect, it } from 'vitest'
import { emptyFrame } from '../schemas/animation.ts'
import type { GraphIR, IR } from '../schemas/ir.ts'
import { withDerivedVisibility } from './visibility.ts'

const evidence = { blockId: 'b', quote: 'A leads to B and C.' }
const graph: GraphIR = {
  type: 'graph',
  title: 'Flow',
  direction: 'LR',
  nodes: [
    { id: 'a', label: 'A', shape: 'box', group: 'outer', evidence },
    { id: 'b', label: 'B', shape: 'box', group: 'inner', evidence },
    { id: 'c', label: 'C', shape: 'box', evidence },
  ],
  edges: [
    { id: 'ab', from: 'a', to: 'b', style: 'solid', evidence },
    { id: 'bc', from: 'b', to: 'c', style: 'solid', evidence },
  ],
  groups: [
    { id: 'outer', label: 'Outer', evidence },
    { id: 'inner', label: 'Inner', parent: 'outer', evidence },
    { id: 'empty', label: 'Empty', evidence },
  ],
}
function freeze(value: object) {
  for (const child of Object.values(value))
    if (child && typeof child === 'object') freeze(child)
  Object.freeze(value)
}

describe('derived animation visibility', () => {
  it('hides edges in IR order, preserving existing entries without duplicates', () => {
    const frame = emptyFrame(['node:b', 'edge:ab'])
    expect(withDerivedVisibility(graph, frame).hidden).toEqual([
      'node:b',
      'edge:ab',
      'edge:bc',
      'group:inner',
    ])
  })
  it('marks edges removed when an endpoint is removed', () => {
    const frame = { ...emptyFrame(), removed: ['node:b' as const] }
    expect(withDerivedVisibility(graph, frame).removed).toEqual([
      'node:b',
      'edge:ab',
      'edge:bc',
    ])
  })
  it('prioritizes hidden endpoints over removed endpoints', () => {
    const frame = { ...emptyFrame(['node:a']), removed: ['node:b' as const] }
    const shown = withDerivedVisibility(graph, frame)
    expect(shown.hidden).toContain('edge:ab')
    expect(shown.removed).toEqual(['node:b', 'edge:bc'])
  })
  it('deduplicates original entries even when a derived entry keeps the same length', () => {
    const frame = emptyFrame(['node:a', 'node:a', 'group:outer'])
    expect(withDerivedVisibility(graph, frame).hidden).toEqual([
      'node:a',
      'group:outer',
      'edge:ab',
    ])
  })
  it('returns the identical frame when endpoints are visible', () => {
    const frame = emptyFrame()
    expect(withDerivedVisibility(graph, frame)).toBe(frame)
  })
  it('hides nested groups only when all direct and descendant members are hidden', () => {
    expect(
      withDerivedVisibility(graph, emptyFrame(['node:b'])).hidden,
    ).not.toContain('group:outer')
    expect(
      withDerivedVisibility(graph, emptyFrame(['node:a', 'node:b'])).hidden,
    ).toEqual([
      'node:a',
      'node:b',
      'edge:ab',
      'edge:bc',
      'group:outer',
      'group:inner',
    ])
  })
  it('leaves empty groups alone and guards cycles in group ancestry', () => {
    const cyclic = {
      ...graph,
      groups: graph.groups.map((g) =>
        g.id === 'outer' ? { ...g, parent: 'inner' } : g,
      ),
    }
    const shown = withDerivedVisibility(
      cyclic,
      emptyFrame(['node:a', 'node:b']),
    )
    expect(shown.hidden).toContain('group:outer')
    expect(shown.hidden).not.toContain('group:empty')
  })
  it('drops tokens crossing explicitly or implicitly hidden edges without mutating frozen inputs', () => {
    const frame = {
      ...emptyFrame(['node:a', 'edge:bc']),
      tokens: [
        { id: 'derived', path: ['ab'] },
        { id: 'explicit', path: ['bc'] },
        { id: 'keep', path: ['other'] },
      ],
    }
    const original = structuredClone(frame)
    freeze(frame)
    freeze(graph)
    const shown = withDerivedVisibility(graph, frame)
    expect(shown.tokens).toEqual([{ id: 'keep', path: ['other'] }])
    expect(frame).toEqual(original)
    expect(withDerivedVisibility(graph, shown)).toBe(shown)
  })
  it.each(['sequence', 'state', 'class', 'er'] as const)(
    'derives %s endpoint visibility',
    (type) => {
      const edge = { id: 'ab', from: 'a', to: 'b', evidence }
      const ir: IR =
        type === 'sequence'
          ? {
              type,
              title: 'Flow',
              participants: [],
              messages: [{ ...edge, label: 'call', kind: 'sync' }],
            }
          : type === 'state'
          ? {
              type,
              title: 'Flow',
              states: [],
              initial: 'a',
              final: [],
              transitions: [{ ...edge, event: 'call' }],
            }
          : type === 'class'
          ? {
              type,
              title: 'Flow',
              classes: [],
              relations: [{ ...edge, kind: 'association' }],
            }
          : {
              type,
              title: 'Flow',
              entities: [],
              relationships: [
                {
                  ...edge,
                  label: 'relates',
                  identifying: false,
                  fromCardinality: 'exactly-one',
                  toCardinality: 'exactly-one',
                },
              ],
            }
      expect(withDerivedVisibility(ir, emptyFrame(['node:b'])).hidden).toEqual([
        'node:b',
        `${type === 'sequence' ? 'msg' : 'edge'}:ab`,
      ])
    },
  )
  it('returns template frames unchanged', () => {
    const frame = emptyFrame(['node:a'])
    const ir: IR = {
      type: 'template',
      templateId: 'array',
      props: { values: [1] },
      evidence: [],
    }
    expect(withDerivedVisibility(ir, frame)).toBe(frame)
  })
})
