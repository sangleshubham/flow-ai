// Measures a rendered visual (browser only) into `RenderGeometry` and runs the §16 L4 checks on it.
// Coordinates are screen pixels relative to the SVG's top-left corner.
import type { LayoutPoint, ValidationIssue } from '@illus/core'

import { checkGeometry } from './geometry.ts'
import type { Box, EdgePath, LabelBox, RenderGeometry } from './geometry.ts'

const SHAPES = '.illus-shape, rect, polygon, ellipse, circle'
const SAMPLE_PX = 6

function boxOf(el: Element, origin: DOMRect): Box | null {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height } : null
}

const union = (boxes: Box[]): Box | null =>
  boxes.length
    ? boxes.reduce((a, b) => {
        const x = Math.min(a.x, b.x)
        const y = Math.min(a.y, b.y)
        return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
      })
    : null

/** Descendants of `el` matching `sel` that belong to `el` itself, not to a nested `data-ir-id` element. */
const own = (el: Element, sel: string) => [...el.querySelectorAll(sel)].filter((c) => c.parentElement?.closest('[data-ir-id]') === el)

/** A path sampled every few pixels, in screen coordinates relative to `origin`. */
function samplePath(path: SVGPathElement, origin: DOMRect): LayoutPoint[] {
  if (typeof path.getTotalLength !== 'function') return []
  const ctm = path.getScreenCTM()
  const len = path.getTotalLength()
  if (!ctm || !(len > 0)) return []
  const n = Math.max(1, Math.ceil(len / SAMPLE_PX))
  return Array.from({ length: n + 1 }, (_, i) => {
    const p = path.getPointAtLength((len * i) / n).matrixTransform(ctm)
    return { x: p.x - origin.left, y: p.y - origin.top }
  })
}

/** Label boxes of every `data-ir-id` element, node shapes, and edge polylines of an SVG visual. */
export function collectGeometry(svg: SVGSVGElement): RenderGeometry {
  const origin = svg.getBoundingClientRect()
  const labels: LabelBox[] = []
  const edges: EdgePath[] = []
  for (const el of svg.querySelectorAll('[data-ir-id]')) {
    const id = el.getAttribute('data-ir-id')!
    const target = el.getAttribute('data-target') ?? ''
    const box = union(own(el, 'text, foreignObject').flatMap((t) => boxOf(t, origin) ?? []))
    if (target.startsWith('edge:')) {
      const line = (el.querySelector('.illus-edge-line') ?? el.querySelector('path')) as SVGPathElement | null
      if (line) edges.push({ id, points: samplePath(line, origin) })
    }
    if (!box) continue
    const label: LabelBox = { id, box }
    if (target.startsWith('node:')) {
      const shapes = own(el, SHAPES).filter((s) => !s.classList.contains('illus-glyph')).flatMap((s) => boxOf(s, origin) ?? [])
      const shape = shapes.sort((a, b) => b.width * b.height - a.width * a.height)[0]
      if (shape) label.shape = shape
    }
    labels.push(label)
  }
  return { width: origin.width, height: origin.height, labels, edges }
}

/** §16 L4 on a rendered visual: the first `<svg>` in `root` (or `root` itself). No SVG (math, html) → no findings. */
export function checkRender(root: Element): { issues: ValidationIssue[]; geometry: RenderGeometry | null } {
  const svg = root instanceof SVGSVGElement ? root : root.querySelector('svg')
  if (!svg) return { issues: [], geometry: null }
  const geometry = collectGeometry(svg)
  return { issues: checkGeometry(geometry), geometry }
}
