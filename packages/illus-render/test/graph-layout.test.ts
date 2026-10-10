import ELK from 'elkjs/lib/elk.bundled.js'
import { make, Q } from '@illus/core/testing'
import { describe, expect, it } from 'vitest'

import { ELK_LAYERED_OPTIONS, runElkLayout } from '../src/graph/elk.ts'
import { graphLayoutInput, nodeSize, wrapLabel } from '../src/graph/measure.ts'

const elk = new ELK()
/** Deterministic stand-in for canvas measureText: 7 px per character. */
const measure = (text: string) => text.length * 7

describe('wrapLabel', () => {
  it('wraps at 22 characters on word boundaries', () => {
    expect(wrapLabel('Leader')).toEqual(['Leader'])
    expect(wrapLabel('AppendEntries messages to every follower')).toEqual(['AppendEntries messages', 'to every follower'])
  })
  it('keeps at most two lines and marks truncation', () => {
    const lines = wrapLabel('one two three four five six seven eight nine ten eleven')
    expect(lines).toHaveLength(2)
    expect(lines[1]!.endsWith('…')).toBe(true)
    expect(lines.every((l) => l.length <= 22)).toBe(true)
  })
  it('hard-breaks words longer than the limit', () => {
    expect(wrapLabel('averyveryverylongidentifiername')).toEqual(['averyveryverylongident', 'ifiername'])
  })
})

describe('nodeSize', () => {
  it('is the longest line plus 24', () => {
    const n = make.graphIR().nodes[1]!
    expect(nodeSize(n, measure).width).toBe(Math.max(64, 'Leader'.length * 7 + 24))
  })
  it('adds a sublabel line', () => {
    const base = make.graphIR().nodes[1]!
    expect(nodeSize({ ...base, sublabel: 'term 3' }, measure).height).toBeGreaterThan(nodeSize(base, measure).height)
  })
})

describe('graphLayoutInput', () => {
  it('maps nodes, groups and edges with measured sizes', () => {
    const ir = make.graphIR({
      nodes: make.graphIR().nodes.map((n, i) => (i < 2 ? { ...n, group: 'g1' } : n)),
      groups: [{ id: 'g1', label: 'Cluster', evidence: Q.request }],
    })
    const input = graphLayoutInput(ir, measure)
    expect(input.algorithm).toBe('layered')
    expect(input.direction).toBe('LR')
    expect(input.nodes.find((n) => n.id === 'client')?.parent).toBe('g1')
    expect(input.nodes.find((n) => n.id === 'g1')).toMatchObject({ width: 0, height: 0 })
    expect(input.edges.find((e) => e.id === 'e1')?.label?.width).toBeGreaterThan(0)
  })
})

describe('runElkLayout (the worker body, run under Node)', () => {
  it('uses the §10 options', () => {
    expect(ELK_LAYERED_OPTIONS).toMatchObject({
      'elk.algorithm': 'layered',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '24',
      'elk.layered.spacing.nodeNodeBetweenLayers': '48',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    })
  })

  it('places every node without overlaps and routes every edge', async () => {
    const res = await runElkLayout(elk, graphLayoutInput(make.graphIR(), measure))
    const boxes = Object.values(res.nodes)
    expect(boxes).toHaveLength(4)
    for (const [i, a] of boxes.entries())
      for (const b of boxes.slice(i + 1))
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
    for (const id of ['e1', 'e2', 'e3', 'e4']) {
      expect(res.edges[id]!.points.length).toBeGreaterThanOrEqual(2)
      expect(res.edges[id]!.label).toBeDefined()
    }
    expect(res.nodes.client!.x).toBeLessThan(res.nodes.leader!.x)
    expect(res.width).toBeGreaterThan(0)
  })

  it('returns absolute coordinates for nested groups', async () => {
    const ir = make.graphIR({
      nodes: make.graphIR().nodes.map((n) => (n.id === 'leader' || n.id === 'log' ? { ...n, group: 'srv' } : n)),
      groups: [{ id: 'srv', label: 'Server', evidence: Q.request }],
    })
    const res = await runElkLayout(elk, graphLayoutInput(ir, measure))
    const g = res.nodes.srv!
    for (const id of ['leader', 'log']) {
      const n = res.nodes[id]!
      expect(n.x).toBeGreaterThanOrEqual(g.x)
      expect(n.y).toBeGreaterThanOrEqual(g.y)
      expect(n.x + n.width).toBeLessThanOrEqual(g.x + g.width)
    }
  })

  it('keeps nodes near their hinted positions when a node is added', async () => {
    const ir = make.graphIR()
    const first = await runElkLayout(elk, graphLayoutInput(ir, measure))
    const hints = Object.fromEntries(Object.entries(first.nodes).map(([id, n]) => [id, { x: n.x, y: n.y }]))
    const grown = make.graphIR({
      nodes: [...ir.nodes, { id: 'f2', label: 'Follower 2', shape: 'box', evidence: Q.appendEntries }],
      edges: [...ir.edges, { id: 'e5', from: 'leader', to: 'f2', style: 'solid', evidence: Q.appendEntries }],
    })
    const second = await runElkLayout(elk, { ...graphLayoutInput(grown, measure), hints })
    const moved = ir.nodes.map((n) => Math.hypot(second.nodes[n.id]!.x - first.nodes[n.id]!.x, second.nodes[n.id]!.y - first.nodes[n.id]!.y))
    expect(moved.reduce((a, b) => a + b, 0) / moved.length).toBeLessThanOrEqual(40)
  })

  it('lays out a grouped graph with position hints and keeps hinted nodes stable (ADR 0044)', async () => {
    const ir = make.graphIR({
      nodes: make.graphIR().nodes.map((n) => (n.id === 'leader' || n.id === 'log' ? { ...n, group: 'srv' } : n)),
      groups: [{ id: 'srv', label: 'Server', evidence: Q.request }],
    })
    const first = await runElkLayout(elk, graphLayoutInput(ir, measure))
    const hints = Object.fromEntries(Object.entries(first.nodes).map(([id, n]) => [id, { x: n.x, y: n.y }]))
    const drift = (r: typeof first) => Object.keys(first.nodes).map((id) => Math.hypot(r.nodes[id]!.x - first.nodes[id]!.x, r.nodes[id]!.y - first.nodes[id]!.y))

    const same = await runElkLayout(elk, { ...graphLayoutInput(ir, measure), hints })
    expect(Math.max(...drift(same))).toBeLessThanOrEqual(20)

    const grown = make.graphIR({
      ...ir,
      nodes: [...ir.nodes, { id: 'f2', label: 'Follower 2', shape: 'box', group: 'srv', evidence: Q.appendEntries }],
      edges: [...ir.edges, { id: 'e5', from: 'leader', to: 'f2', style: 'solid', evidence: Q.appendEntries }],
    })
    const second = await runElkLayout(elk, { ...graphLayoutInput(grown, measure), hints })
    expect(second.nodes.f2).toBeDefined()
    const moved = drift(second)
    expect(moved.reduce((a, b) => a + b, 0) / moved.length).toBeLessThanOrEqual(40)
  })
})
