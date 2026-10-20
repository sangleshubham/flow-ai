import type { GraphColor, GraphGroup } from '@illus/core'
import { make, Q } from '@illus/core/testing'
import { describe, expect, it } from 'vitest'

import { assignGroupColors } from '../src/graph/group-colors.ts'

const group = (
  id: string,
  parent?: string,
  color?: GraphColor,
): GraphGroup => ({
  id,
  label: id,
  evidence: Q.request,
  ...(parent ? { parent } : {}),
  ...(color ? { color } : {}),
})
const palette = ['blue', 'green', 'orange', 'red', 'purple', 'gray']

describe('assignGroupColors', () => {
  it('assigns siblings in IR order, deterministically, without mutating the IR', () => {
    const ir = make.graphIR({
      nodes: [],
      edges: [],
      groups: palette.map((_, i) => group(`g${i}`)),
    })
    const before = structuredClone(ir)
    const colors = assignGroupColors(ir)
    expect([...colors.groups.values()]).toEqual(palette)
    expect(assignGroupColors(structuredClone(ir))).toEqual(colors)
    expect(ir).toEqual(before)
    expect(
      assignGroupColors(make.graphIR({ groups: [], nodes: [] })).groups.size,
    ).toBe(0)
  })

  it('reserves explicit colours even when they appear later, including explicit node colours', () => {
    const ir = make.graphIR({
      groups: [group('auto'), group('explicit', undefined, 'blue')],
      nodes: [
        {
          id: 'n',
          label: 'N',
          shape: 'box',
          color: 'green',
          evidence: Q.request,
        },
      ],
    })
    const colors = assignGroupColors(ir)
    expect(colors.groups.get('auto')).toBe('orange')
    expect(colors.groups.get('explicit')).toBe('blue')
    expect(colors.nodes.get('n')).toBe('green')
  })

  it('uses every unused sibling colour before reusing one, even if all colours are explicit elsewhere', () => {
    const ir = make.graphIR({
      groups: [
        group('parent'),
        ...palette.map((color, i) =>
          group(`explicit${i}`, 'parent', color as GraphColor),
        ),
        ...palette.map((_, i) => group(`auto${i}`)),
      ],
    })
    const colors = assignGroupColors(ir).groups
    expect(
      new Set(
        ['parent', ...palette.slice(0, 5).map((_, i) => `auto${i}`)].map((id) =>
          colors.get(id),
        ),
      ).size,
    ).toBe(6)
    expect(palette).toContain(colors.get('auto5'))
    for (const [i, color] of palette.entries())
      expect(colors.get(`explicit${i}`)).toBe(color)
  })

  it('distinguishes nested groups from parents, including forward parents and palette exhaustion', () => {
    const ir = make.graphIR({
      groups: [
        group('first', 'parent'),
        group('parent'),
        group('second', 'parent'),
        ...Array.from({ length: 10 }, (_, i) => group(`child${i}`, 'parent')),
        group('grandchild', 'first'),
      ],
    })
    const colors = assignGroupColors(ir).groups
    const children = ir.groups.filter((g) => g.parent === 'parent')
    expect(
      new Set(children.slice(0, 5).map((g) => colors.get(g.id))).size,
    ).toBe(5)
    for (const g of ir.groups)
      if (g.parent) expect(colors.get(g.id)).not.toBe(colors.get(g.parent))
    expect(colors.get('first')).toBe('green')
    expect(colors.get('second')).toBe('orange')
  })

  it('preserves explicit parent/child and sibling collisions', () => {
    const colors = assignGroupColors(
      make.graphIR({
        groups: [
          group('parent', undefined, 'red'),
          group('a', 'parent', 'red'),
          group('b', 'parent', 'red'),
          group('auto', 'parent'),
        ],
      }),
    ).groups
    expect(colors.get('parent')).toBe('red')
    expect(colors.get('a')).toBe('red')
    expect(colors.get('b')).toBe('red')
    expect(colors.get('auto')).not.toBe('red')
  })

  it('inherits only the immediate group colour and preserves explicit and ungrouped nodes', () => {
    const ir = make.graphIR({
      groups: [group('parent'), group('child', 'parent')],
      nodes: [
        {
          id: 'a',
          label: 'A',
          shape: 'box',
          group: 'parent',
          evidence: Q.request,
        },
        {
          id: 'b',
          label: 'B',
          shape: 'box',
          group: 'child',
          evidence: Q.request,
        },
        {
          id: 'c',
          label: 'C',
          shape: 'box',
          group: 'child',
          color: 'red',
          evidence: Q.request,
        },
        { id: 'd', label: 'D', shape: 'box', evidence: Q.request },
        {
          id: 'e',
          label: 'E',
          shape: 'box',
          group: 'missing',
          evidence: Q.request,
        },
      ],
    })
    const colors = assignGroupColors(ir)
    expect(colors.nodes.get('a')).toBe(colors.groups.get('parent'))
    expect(colors.nodes.get('b')).toBe(colors.groups.get('child'))
    expect(colors.nodes.get('c')).toBe('red')
    expect(colors.nodes.has('d')).toBe(false)
    expect(colors.nodes.has('e')).toBe(false)
  })
})
