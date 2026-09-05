// @vitest-environment jsdom
// Section views (§13 rendering), focus mode, interactive layout hints and the displacement target.
import ELK from 'elkjs/lib/elk.bundled.js'
import { describe, expect, it, vi } from 'vitest'

import type { ConceptModel, GraphIR, LayoutGraphFn, PatchOp } from '@illus/core'
import { Q, make } from '@illus/core/testing'
import { graphLayoutInput, runElkLayout } from '@illus/render'

import { applyPatches } from '../apply.ts'
import { createConceptModels } from '../generate.ts'
import { FOCUS_THRESHOLD, conceptLayoutGraph, focusGraph, meanDisplacement, sectionView, withLayout } from '../view.ts'
import { MODEL_ID, SECTION_IDS, buildRaftBook, oracle } from './raft-book.ts'

const node = (id: string, extra: object = {}): PatchOp => ({ op: 'addNode', node: { id, label: id, shape: 'box', evidence: Q.request, ...extra } })
const edge = (id: string, from: string, to: string): PatchOp => ({ op: 'addEdge', edge: { id, from, to, label: id, style: 'solid', evidence: Q.request } })
const patch = (ord: number, ops: PatchOp[]) => make.patch({ patchId: `m@${ord}`, sectionId: `s${ord}`, sectionOrdinal: ord, ops })

/**
 * W4's runElkLayout sets the INTERACTIVE strategies on the root only; with groups (INCLUDE_CHILDREN) ELK then
 * rejects the graph. Copies them onto compound nodes, as proposed to W4 in ADR 0043 (remove once W4 ships it).
 */
function interactiveCompounds(elk: InstanceType<typeof ELK>): InstanceType<typeof ELK> {
  type N = { layoutOptions?: Record<string, string>; children?: N[] }
  const KEYS = ['elk.layered.cycleBreaking.strategy', 'elk.layered.layering.strategy', 'elk.layered.crossingMinimization.strategy']
  const spread = (n: N, opts: Record<string, string>) => {
    for (const c of n.children ?? []) {
      if (c.children?.length) c.layoutOptions = { ...opts, ...c.layoutOptions }
      spread(c, opts)
    }
  }
  return new Proxy(elk, {
    get: (t, k) =>
      k === 'layout'
        ? (g: N, ...rest: unknown[]) => {
            const opts = Object.fromEntries(KEYS.filter((key) => g.layoutOptions?.[key]).map((key) => [key, g.layoutOptions![key]!]))
            spread(g, opts)
            return (t.layout as (...a: unknown[]) => unknown)(g, ...rest)
          }
        : Reflect.get(t, k),
  })
}

async function inOrderModel(): Promise<ConceptModel> {
  const { repos } = await buildRaftBook()
  const llm = {
    call: async (_r: string, ctx: { body: string }, o: { sectionId?: string } = {}) => ({
      data: oracle(o.sectionId!, ctx.body), model: 'm', effort: 'medium', promptVersion: '1.0.0', usage: { input: 0, output: 0, cachedInput: 0 }, latencyMs: 0, requestId: 'r',
    }),
  } as never
  const cm = createConceptModels({ repos, llm })
  for (const id of SECTION_IDS) await cm.generatePatch(id, MODEL_ID)
  return (await repos.conceptModels.get(MODEL_ID))!
}

describe('sectionView', () => {
  const m = make.conceptModel({
    patches: [
      patch(1, [node('a'), node('b'), edge('e1', 'a', 'b')]),
      patch(3, [node('c'), edge('e2', 'b', 'c'), { op: 'update', id: 'a', label: 'A2', evidence: Q.reply }, { op: 'remove', id: 'e1', evidence: Q.reply }, { op: 'annotate', id: 'c', text: 'new!', evidence: Q.reply }]),
    ],
  })

  it('marks S’s additions and updates new, and keeps removed elements for the fade-out', () => {
    const v = sectionView(m, 3)
    expect(v.newIds).toEqual(['c', 'e2', 'a'])
    expect(v.removedIds).toEqual(['e1'])
    expect((v.ir as GraphIR).edges.map((e) => e.id)).toEqual(['e2', 'e1'])
    expect(v.frame.removed).toEqual(['edge:e1'])
    expect(v.frame.annotations).toEqual({ 'node:c': 'new!' })
  })

  it('a section without a patch shows the model with nothing new', () => {
    const v = sectionView(m, 2)
    expect(v.newIds).toEqual([])
    expect((v.ir as GraphIR).nodes.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('toggle "only this section’s additions" keeps S’s elements and the endpoints they need', () => {
    const v = sectionView(m, 3, { onlyNew: true })
    expect((v.ir as GraphIR).nodes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect((v.ir as GraphIR).edges.map((e) => e.id)).toEqual(['e2', 'e1'])
    const v1 = sectionView(make.conceptModel({ patches: [patch(1, [node('a'), node('b')]), patch(2, [node('c'), edge('e', 'c', 'a')])] }), 2, { onlyNew: true })
    expect((v1.ir as GraphIR).nodes.map((n) => n.id)).toEqual(['a', 'c'])
  })

  describe('focus mode past 24 nodes', () => {
    const groups: PatchOp[] = [
      { op: 'addGroup', group: { id: 'left', label: 'Left', evidence: Q.request } },
      { op: 'addGroup', group: { id: 'right', label: 'Right', evidence: Q.request } },
    ]
    const many = Array.from({ length: 26 }, (_, i) => node(`n${i}`, { group: i % 2 ? 'right' : 'left' }))
    const chain = Array.from({ length: 25 }, (_, i) => edge(`c${i}`, `n${i}`, `n${i + 1}`))
    const chunks = (ops: PatchOp[]) => Array.from({ length: Math.ceil(ops.length / 8) }, (_, i) => ops.slice(i * 8, i * 8 + 8))
    const base = [...groups, ...many, ...chain]
    const big = make.conceptModel({ patches: [...chunks(base).map((ops, i) => patch(i + 1, ops)), patch(20, [node('new', { group: 'left' }), edge('enew', 'n10', 'new')])] })

    it('shows S’s new elements plus one hop, the rest collapsed into their groups', () => {
      const v = sectionView(big, 20)
      expect(applyPatches(big).state.elements.filter((e) => e.type === 'node')).toHaveLength(27)
      expect(v.focus).toBe(true)
      const ir = v.ir as GraphIR
      const real = ir.nodes.filter((n) => !v.collapsed[n.id]).map((n) => n.id)
      expect(real.sort()).toEqual(['n10', 'n11', 'n9', 'new'].sort())
      expect(Object.values(v.collapsed).flat()).toHaveLength(23)
      const placeholders = ir.nodes.filter((n) => v.collapsed[n.id])
      expect(placeholders.map((n) => n.group).sort()).toEqual(['left', 'right'])
      expect(placeholders.every((n) => /^\d+ more$/.test(n.label))).toBe(true)
      for (const e of ir.edges) expect(ir.nodes.some((n) => n.id === e.from) && ir.nodes.some((n) => n.id === e.to)).toBe(true)
      expect(v.newIds).toEqual(['new', 'enew'])
    })

    it('"show full model" turns focus mode off', () => {
      const v = sectionView(big, 20, { fullModel: true })
      expect(v.focus).toBe(false)
      expect((v.ir as GraphIR).nodes).toHaveLength(27)
    })

    it('stays off at or below the threshold', () => {
      const ir = make.graphIR()
      expect(ir.nodes.length).toBeLessThanOrEqual(FOCUS_THRESHOLD)
      expect(focusGraph(ir, new Set()).ir).toBe(ir)
    })
  })
})

describe('layout stability', () => {
  it('stored positions become ELK hints; renderer hints win', async () => {
    const base = vi.fn<LayoutGraphFn>(async () => ({ width: 0, height: 0, nodes: {}, edges: {} }))
    const f = conceptLayoutGraph({ layout: { a: { x: 1, y: 2 }, gone: { x: 0, y: 0 } } }, base)
    await f({ algorithm: 'layered', direction: 'LR', nodes: [{ id: 'a', width: 10, height: 10 }, { id: 'b', width: 10, height: 10 }], edges: [], hints: { b: { x: 5, y: 5 } } })
    expect(base.mock.calls.map((c) => c[0].hints)).toEqual([
      { a: { x: 1, y: 2 }, b: { x: 5, y: 5 } },
      { a: { x: 1, y: 2 }, b: { x: 5, y: 5 } },
    ])
    const c = await f({ algorithm: 'layered', direction: 'LR', nodes: [{ id: 'a', width: 10, height: 10 }, { id: 'n', width: 10, height: 10 }], edges: [{ id: 'e', from: 'a', to: 'n' }] })
    // A new node is hinted one layer after its placed neighbour.
    expect(base.mock.calls.at(-2)![0].hints!.n!.x).toBe(1 + 10 + 48)
    expect(c).toEqual({ width: 0, height: 0, nodes: {}, edges: {} })
    await conceptLayoutGraph({}, base)({ algorithm: 'layered', direction: 'LR', nodes: [], edges: [] })
    expect(base.mock.calls.at(-1)![0].hints).toBeUndefined()
  })

  it('meanDisplacement averages over shared nodes', () => {
    expect(meanDisplacement({ a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }, { a: { x: 3, y: 4 }, b: { x: 0, y: 0 }, c: { x: 99, y: 99 } })).toBe(2.5)
    expect(meanDisplacement({}, { a: { x: 1, y: 1 } })).toBe(0)
  })

  /** Lays out sections 1–5 in order like the pane does (render, store positions, next section). */
  async function evolve(elk: InstanceType<typeof ELK>) {
    const measure = (text: string) => text.length * 7
    let model = await inOrderModel()
    const moves: { mean: number; shared: number }[] = []
    let prev: Record<string, { x: number; y: number }> | undefined
    for (let n = 1; n <= 5; n++) {
      const ir = sectionView(model, n).ir as GraphIR
      const result = await conceptLayoutGraph(model, (input) => runElkLayout(elk, input))(graphLayoutInput(ir, measure))
      const nodes = Object.fromEntries(ir.nodes.map((x) => [x.id, result.nodes[x.id]!]))
      if (prev) moves.push({ mean: meanDisplacement(prev, nodes), shared: Object.keys(prev).length })
      prev = nodes
      model = withLayout(model, result)
    }
    return moves
  }

  it('existing nodes move ≤ 40 px on average between consecutive sections (real ELK, interactive; ADR 0043)', async () => {
    const moves = await evolve(interactiveCompounds(new ELK()))
    expect(moves).toHaveLength(4)
    // §18 metric: mean over every existing node's move between consecutive sections.
    const pooled = moves.reduce((s, m) => s + m.mean * m.shared, 0) / moves.reduce((s, m) => s + m.shared, 0)
    expect(pooled).toBeLessThanOrEqual(40)
    // Per transition: 3 of 4 meet 40 px; 6.2 → 6.3 (two back edges into the group) moves about 81 px (ADR 0043).
    expect(moves.filter((m) => m.mean <= 40)).toHaveLength(3)
    for (const m of moves) expect(m.mean).toBeLessThanOrEqual(100)
  })

  it('falls back to a fresh layout when W4 rejects hints on grouped graphs', async () => {
    const moves = await evolve(new ELK())
    expect(moves).toHaveLength(4)
  })
})
