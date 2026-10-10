// §16 L4 render checks on measured geometry (DOM-free): label overlaps, text overflow, aspect ratio and
// edge crossings. `collectGeometry` (dom.ts) measures a rendered SVG into this shape.
import type { LayoutPoint, ValidationIssue } from '@illus/core'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The text of one IR element (`data-ir-id`) and, for nodes, the shape that should contain it. */
export interface LabelBox {
  id: string
  box: Box
  shape?: Box
}

export interface EdgePath {
  id: string
  points: LayoutPoint[]
}

export interface RenderGeometry {
  width: number
  height: number
  labels: LabelBox[]
  edges: EdgePath[]
}

/** §16 limits. */
export const RENDER_LIMITS = { overlapPx: 2, maxAspect: 4, maxCrossings: 10 } as const

/** Codes of render issues (layer `render`). */
export type RenderIssueCode = 'label-overlap' | 'text-overflow' | 'aspect-ratio' | 'edge-crossings'

const issue = (code: RenderIssueCode, message: string, elementId?: string): ValidationIssue => ({
  layer: 'render',
  severity: 'warning',
  code,
  message,
  ...(elementId && { elementId }),
})

function cross(o: LayoutPoint, a: LayoutPoint, b: LayoutPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/** Proper intersection point of segments ab and cd (shared endpoints and collinear overlaps do not count). */
function intersection(a: LayoutPoint, b: LayoutPoint, c: LayoutPoint, d: LayoutPoint): LayoutPoint | null {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  if (!(((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))) return null
  const t = d1 / (d1 - d2)
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
}

const near = (p: LayoutPoint, q: LayoutPoint, r: number) => Math.hypot(p.x - q.x, p.y - q.y) <= r

/**
 * Number of points where two different edges cross. Meetings within `endRadius` px of an edge's end are
 * not crossings: edges that share a node meet there. O(segments²), fine for ≤ 18 edges.
 */
export function countCrossings(edges: readonly EdgePath[], endRadius = 4): number {
  let n = 0
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i]!.points
      const b = edges[j]!.points
      const ends = [a[0], a.at(-1), b[0], b.at(-1)].filter((p): p is LayoutPoint => !!p)
      for (let s = 1; s < a.length; s++)
        for (let t = 1; t < b.length; t++) {
          const p = intersection(a[s - 1]!, a[s]!, b[t - 1]!, b[t]!)
          if (p && !ends.some((e) => near(p, e, endRadius))) n++
        }
    }
  return n
}

const overlapOf = (a: Box, b: Box) => ({
  x: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  y: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
})

/** Longer side over shorter side. */
export function aspectRatio(g: Pick<RenderGeometry, 'width' | 'height'>): number {
  const lo = Math.min(g.width, g.height)
  return lo > 0 ? Math.max(g.width, g.height) / lo : Infinity
}

/** The §16 L4 checks. Every finding is a `warning`: the visual is still shown; the caller re-lays out or repairs. */
export function checkGeometry(g: RenderGeometry): ValidationIssue[] {
  const out: ValidationIssue[] = []
  const tol = RENDER_LIMITS.overlapPx
  for (let i = 0; i < g.labels.length; i++)
    for (let j = i + 1; j < g.labels.length; j++) {
      const a = g.labels[i]!
      const b = g.labels[j]!
      if (a.id === b.id) continue
      const o = overlapOf(a.box, b.box)
      if (o.x > tol && o.y > tol) out.push(issue('label-overlap', `labels of ${a.id} and ${b.id} overlap by ${Math.round(o.x)}×${Math.round(o.y)} px`, a.id))
    }
  for (const l of g.labels) {
    if (!l.shape) continue
    const left = l.shape.x - l.box.x
    const right = l.box.x + l.box.width - (l.shape.x + l.shape.width)
    if (left > tol || right > tol) out.push(issue('text-overflow', `the label of ${l.id} is ${Math.round(Math.max(left, right))} px wider than its shape`, l.id))
  }
  const aspect = aspectRatio(g)
  if (aspect > RENDER_LIMITS.maxAspect) out.push(issue('aspect-ratio', `aspect ratio ${aspect.toFixed(1)}:1 is beyond ${RENDER_LIMITS.maxAspect}:1`))
  const crossings = countCrossings(g.edges)
  if (crossings > RENDER_LIMITS.maxCrossings)
    out.push(issue('edge-crossings', `${crossings} edge crossings (more than ${RENDER_LIMITS.maxCrossings}): split into two visuals or group nodes`))
  return out
}
