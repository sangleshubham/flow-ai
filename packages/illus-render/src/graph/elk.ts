// The layout worker's body (§10): LayoutGraphInput → ELK JSON → LayoutGraphResult with absolute
// coordinates. Kept free of worker APIs so it also runs under Node in tests.
import type { ELK, ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js'

import type { LayoutGraphInput, LayoutGraphResult, LayoutPoint } from '@illus/core'

/** §10 graph options. Coordinates come back relative to the root so groups need no offset maths. */
export const ELK_LAYERED_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.nodeNode': '24',
  'elk.layered.spacing.nodeNodeBetweenLayers': '48',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.edgeLabels.placement': 'CENTER',
  'elk.json.shapeCoords': 'ROOT',
  'elk.json.edgeCoords': 'ROOT',
} as const

/** Deterministic `stress` for algorithmic graphs (§10 graph-ds template). */
export const ELK_STRESS_OPTIONS = {
  'elk.algorithm': 'stress',
  'elk.stress.desiredEdgeLength': '80',
  'elk.randomSeed': '1',
  'elk.json.shapeCoords': 'ROOT',
  'elk.json.edgeCoords': 'ROOT',
} as const

/**
 * With position hints, ELK keeps the previous order so unchanged nodes stay put (§11, §13).
 * Semi-interactive LAYER_SWEEP (ordered by each node's `elk.position`) instead of the INTERACTIVE crossing
 * minimiser: it is hierarchy-aware, so compound graphs work, and it still places edge-label dummies sensibly.
 * Model order is off so it cannot override the hinted order. Applied to the root and every group (ADR 0043).
 */
const INTERACTIVE_LAYERED = {
  'elk.interactiveLayout': 'true',
  'elk.layered.cycleBreaking.strategy': 'INTERACTIVE',
  'elk.layered.layering.strategy': 'INTERACTIVE',
  'elk.layered.crossingMinimization.semiInteractive': 'true',
  'elk.layered.considerModelOrder.strategy': 'NONE',
} as const
const INTERACTIVE_STRESS = { 'elk.interactive': 'true' } as const

/** Padding of a group box; the top band holds the group label. */
export const GROUP_PADDING = { top: 30, side: 12 }
const ROOT_ID = '__illus_root'

/** A new node without a hint starts one layer after a hinted neighbour, so interactive ELK keeps the order. */
function neighbourHint(input: LayoutGraphInput, id: string): LayoutPoint | undefined {
  for (const e of input.edges) {
    const other = e.to === id ? e.from : e.from === id ? e.to : undefined
    const p = other !== undefined ? input.hints?.[other] : undefined
    if (p) {
      const step = e.to === id ? 1 : -1
      return input.direction === 'LR' ? { x: p.x + step * 120, y: p.y } : { x: p.x, y: p.y + step * 90 }
    }
  }
  return undefined
}

export async function runElkLayout(elk: ELK, input: LayoutGraphInput): Promise<LayoutGraphResult> {
  const hinted = input.hints !== undefined && Object.keys(input.hints).length > 0
  const base = input.algorithm === 'stress' ? ELK_STRESS_OPTIONS : ELK_LAYERED_OPTIONS
  const interactive = hinted ? (input.algorithm === 'stress' ? INTERACTIVE_STRESS : INTERACTIVE_LAYERED) : {}
  const parents = new Set(input.nodes.map((n) => n.parent).filter((p): p is string => !!p))

  const byId = new Map<string, ElkNode>()
  for (const n of input.nodes) {
    const hint = input.hints?.[n.id] ?? (hinted ? neighbourHint(input, n.id) : undefined)
    const node: ElkNode = { id: n.id, children: [] }
    if (parents.has(n.id)) {
      node.layoutOptions = {
        'elk.padding': `[top=${GROUP_PADDING.top},left=${GROUP_PADDING.side},bottom=${GROUP_PADDING.side},right=${GROUP_PADDING.side}]`,
        // ELK requires the same (hierarchy-aware) strategies on every compound node as on the root.
        ...interactive,
      }
    } else {
      node.width = n.width
      node.height = n.height
    }
    if (hint) {
      node.x = hint.x
      node.y = hint.y
      node.layoutOptions = { ...node.layoutOptions, 'elk.position': `(${hint.x}, ${hint.y})` }
    }
    byId.set(n.id, node)
  }
  const root: ElkNode = {
    id: ROOT_ID,
    layoutOptions: { ...base, 'elk.direction': input.direction === 'LR' ? 'RIGHT' : 'DOWN', ...interactive },
    children: [],
    edges: input.edges.map(
      (e): ElkExtendedEdge => ({
        id: e.id,
        sources: [e.from],
        targets: [e.to],
        ...(e.label ? { labels: [{ text: e.id, width: e.label.width, height: e.label.height }] } : {}),
      }),
    ),
  }
  for (const n of input.nodes) {
    const parent = n.parent ? byId.get(n.parent) : undefined
    ;(parent ?? root).children!.push(byId.get(n.id)!)
  }
  // Edges whose endpoints are missing would make ELK throw; validators drop them, this is a safety net.
  root.edges = root.edges!.filter((e) => byId.has((e as ElkExtendedEdge).sources[0]!) && byId.has((e as ElkExtendedEdge).targets[0]!))

  const out = await elk.layout(root)

  const result: LayoutGraphResult = { width: out.width ?? 0, height: out.height ?? 0, nodes: {}, edges: {} }
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      result.nodes[c.id] = { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 }
      walk(c)
    }
  }
  walk(out)
  const collectEdges = (n: ElkNode) => {
    for (const e of (n.edges ?? []) as ElkExtendedEdge[]) {
      const points: LayoutPoint[] = []
      for (const s of e.sections ?? []) points.push(s.startPoint, ...(s.bendPoints ?? []), s.endPoint)
      const lab = e.labels?.[0]
      result.edges[e.id] = {
        points,
        ...(lab && lab.x !== undefined ? { label: { x: lab.x + (lab.width ?? 0) / 2, y: lab.y! + (lab.height ?? 0) / 2 } } : {}),
      }
    }
    for (const c of n.children ?? []) collectEdges(c)
  }
  collectEdges(out)
  return result
}
