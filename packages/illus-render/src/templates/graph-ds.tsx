// `graph-ds` template (§10): an algorithmic graph with weights, visit state and distances, laid out by
// ELK `stress` (deterministic with a fixed seed) in the layout worker.
import { useEffect, useState } from 'react'
import { z } from 'zod'

import type { LayoutGraphInput, LayoutGraphResult } from '@illus/core'

import { runElkLayout } from '../graph/elk.ts'
import { layoutGraph } from '../graph/layout-client.ts'
import type { TemplateViewProps } from '../types.ts'

import { Arrow, BASE_ACTIONS, Decor, defineTemplate, duplicates, Id, Kit, listPath, PAD, T, TemplateDropError, TemplateSvg, Text, textW, TOP, Val, without } from './kit.tsx'
import type { Pt } from './kit.tsx'

const Props = z.object({
  label: Text.optional(),
  directed: z.boolean(),
  weighted: z.boolean(),
  nodes: z.array(z.object({ id: Id, label: z.string().min(1).max(12), state: z.enum(['unvisited', 'frontier', 'visited']).optional(), distance: Val.optional() })).min(1).max(14),
  edges: z.array(z.object({ id: Id, from: Id, to: Id, weight: z.number().optional() })).max(28),
})
type Props = z.infer<typeof Props>
type Layout = LayoutGraphInput

const radius = (label: string) => Math.max(17, textW(label, 13) / 2 + 7)

/** ELK input: circles as squares of their diameter. The component runs ELK `stress` on it. */
function layout(p: Props): Layout {
  return {
    algorithm: 'stress',
    direction: 'LR',
    nodes: p.nodes.map((n) => ({ id: n.id, width: radius(n.label) * 2, height: radius(n.label) * 2 })),
    edges: p.edges.map((e) => ({ id: e.id, from: e.from, to: e.to })),
  }
}

async function runLayout(input: Layout): Promise<LayoutGraphResult> {
  if (typeof Worker !== 'undefined') return layoutGraph(input)
  // No workers (tests, server): run ELK on this thread.
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  return runElkLayout(new ELK(), input)
}

function GraphDsView({ ir, props: p, layout: input, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const [pos, setPos] = useState<LayoutGraphResult | null>(null)
  const [failed, setFailed] = useState<unknown>(null)
  const key = JSON.stringify(input)
  useEffect(() => {
    let live = true
    runLayout(input).then(
      (r) => live && setPos(r),
      (e: unknown) => live && setFailed(e),
    )
    return () => {
      live = false
    }
    // `key` stands for `input`, which is a fresh object on every render.
  }, [key])
  if (failed) throw failed instanceof Error ? failed : new Error(String(failed))
  if (!pos) return null
  const kit = new Kit(ir, frame)
  const top = TOP + (p.label ? 18 : 0)
  const at = (id: string) => {
    const n = pos.nodes[id]!
    return { cx: PAD + n.x + n.width / 2, cy: top + n.y + n.height / 2, r: n.width / 2 }
  }
  const pairs = new Set(p.edges.map((e) => `${e.from}>${e.to}`))
  return (
    <TemplateSvg width={pos.width + PAD * 2 + 20} height={pos.height + top + 40} label={p.label ?? 'graph'} onReady={onReady}>
      {p.label && (
        <T x={PAD} y={TOP - 4} cls="t-cap" anchor="start">
          {p.label}
        </T>
      )}
      {p.edges.map((e, i) => {
        const a = at(e.from)
        const b = at(e.to)
        const len = Math.hypot(b.cx - a.cx, b.cy - a.cy) || 1
        const ux = (b.cx - a.cx) / len
        const uy = (b.cy - a.cy) / len
        const pts: Pt[] = [
          [a.cx + ux * a.r, a.cy + uy * a.r],
          [b.cx - ux * (b.r + 1), b.cy - uy * (b.r + 1)],
        ]
        kit.line(e.id, pts)
        const t = `edge:${e.id}`
        // Opposite directed edges bend apart so both stay visible.
        const curve = p.directed && pairs.has(`${e.to}>${e.from}`) ? 14 : 0
        const weight = kit.val(t, e.weight ?? '')
        const mx = (pts[0]![0] + pts[1]![0]) / 2 - uy * curve * 0.5
        const my = (pts[0]![1] + pts[1]![1]) / 2 + ux * curve * 0.5
        kit.at(t, { x: mx - 10, y: my - 8, w: 20, h: 16 })
        return (
          <g key={e.id} {...kit.el(`edges.${i}`, t)}>
            <Arrow pts={pts} curve={curve} arrowHead={p.directed} />
            {weight !== '' && (
              <>
                <rect x={mx - textW(weight, 11, true) / 2 - 4} y={my - 8} width={textW(weight, 11, true) + 8} height={16} rx={3} className="illus-label-bg" />
                <T x={mx} y={my} cls="t-mono t-cap">
                  {weight}
                </T>
              </>
            )}
          </g>
        )
      })}
      {p.nodes.map((n, i) => {
        const { cx, cy, r } = at(n.id)
        const t = `node:${n.id}`
        kit.at(t, { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r })
        const dist = kit.val(t, n.distance ?? '')
        return (
          <g key={n.id} {...kit.el(`nodes.${i}`, t)}>
            <circle cx={cx} cy={cy} r={r} className={n.state === 'visited' ? 't-visited' : n.state === 'frontier' ? 't-frontier' : 't-cell'} />
            <T x={cx} y={cy}>
              {n.label}
            </T>
            {dist !== '' && (
              <g className="t-badge" data-value-for={t}>
                <rect x={cx + r * 0.55} y={cy - r - 6} width={Math.max(18, textW(dist, 10, true) + 10)} height={16} rx={8} />
                <T x={cx + r * 0.55 + Math.max(18, textW(dist, 10, true) + 10) / 2} y={cy - r + 2}>
                  {dist}
                </T>
              </g>
            )}
          </g>
        )
      })}
      <Decor kit={kit} />
    </TemplateSvg>
  )
}

function checkInvariants(p: Props): string[] {
  const out: string[] = []
  const ids = new Set(p.nodes.map((n) => n.id))
  for (const d of duplicates(p.nodes.map((n) => n.id))) out.push(`node id ${d} is used twice`)
  for (const d of duplicates(p.edges.map((e) => e.id))) out.push(`edge id ${d} is used twice`)
  for (const d of duplicates(p.nodes.map((n) => n.label))) out.push(`node label ${d} is used twice`)
  const seen = new Set<string>()
  for (const e of p.edges) {
    for (const end of [e.from, e.to]) if (!ids.has(end)) out.push(`edge ${e.id}: node ${end} does not exist`)
    if (e.from === e.to) out.push(`edge ${e.id} is a self-loop`)
    if (p.weighted && e.weight === undefined) out.push(`edge ${e.id} has no weight in a weighted graph`)
    if (!p.weighted && e.weight !== undefined) out.push(`edge ${e.id} has a weight but the graph is unweighted`)
    const k = p.directed ? `${e.from}>${e.to}` : [e.from, e.to].sort().join('~')
    if (seen.has(k)) out.push(`edge ${e.id} duplicates another edge between ${e.from} and ${e.to}`)
    seen.add(k)
  }
  return out
}

export const graphDsTemplate = defineTemplate<Props, Layout>({
  id: 'graph-ds',
  description: 'An algorithmic graph: labelled vertices, directed or undirected edges with optional weights, and per-vertex visit state (unvisited, frontier, visited) and distance.',
  whenToUse: 'Use for graph algorithms on a concrete small graph: BFS and DFS, Dijkstra and Bellman-Ford, topological sort, minimum spanning trees, connected components. Not for architecture or data-flow diagrams (use kind `graph`). At most 14 vertices and 28 edges.',
  propsSchema: Props,
  example: {
    label: 'Dijkstra from A',
    directed: true,
    weighted: true,
    nodes: [
      { id: 'A', label: 'A', state: 'visited', distance: 0 },
      { id: 'B', label: 'B', state: 'frontier', distance: 4 },
      { id: 'C', label: 'C', state: 'visited', distance: 1 },
      { id: 'D', label: 'D', state: 'frontier', distance: 6 },
      { id: 'E', label: 'E' },
    ],
    edges: [
      { id: 'AB', from: 'A', to: 'B', weight: 4 },
      { id: 'AC', from: 'A', to: 'C', weight: 1 },
      { id: 'CB', from: 'C', to: 'B', weight: 2 },
      { id: 'CD', from: 'C', to: 'D', weight: 5 },
      { id: 'BE', from: 'B', to: 'E', weight: 3 },
      { id: 'DE', from: 'D', to: 'E', weight: 1 },
    ],
  },
  exampleEvidence: [
    { path: 'nodes.0', evidence: { blockId: 'b-dijkstra-1', quote: 'the distance to the source A is zero' } },
    { path: 'edges.2', evidence: { blockId: 'b-dijkstra-2', quote: 'the edge from C to B has weight 2' } },
    { path: 'edges', evidence: { blockId: 'b-dijkstra-1', quote: 'a directed graph with non-negative edge weights' } },
  ],
  evidencePaths: '`nodes` or `nodes.<i>`, `edges` or `edges.<i>`.',
  targetsDoc: '`node:<id>` for a vertex (`set` shows its distance), `edge:<id>` for an edge (`set` changes its weight label). Visiting is `highlight`; relaxing an edge is `highlight` on the edge plus `set` on the vertex. `token` paths run along edge ids.',
  targets: (p) => [...p.nodes.map((n) => `node:${n.id}`), ...p.edges.map((e) => `edge:${e.id}`)],
  supportedActions: [...BASE_ACTIONS, 'set', 'pointer', 'token', 'remove'],
  checkInvariants,
  dropElement(p, path) {
    const lp = listPath(path)
    if (lp?.list === 'edges' && !lp.rest) return { ...p, edges: without(p.edges, lp.index) }
    if (lp?.list === 'nodes' && !lp.rest && p.nodes.length > 1) {
      const id = p.nodes[lp.index]?.id
      return { ...p, nodes: without(p.nodes, lp.index), edges: p.edges.filter((e) => e.from !== id && e.to !== id) }
    }
    throw new TemplateDropError('graph-ds', path)
  },
  layout,
  Component: GraphDsView,
})
