// Text measurement and ELK input for the graph renderer (§10): node sizes are measured before layout,
// labels wrap at 22 characters, max 2 lines plus 1 sublabel line, width = longest line + 24.
import type { GraphIR, GraphNode, LayoutGraphInput } from '@illus/core'

export const WRAP = 22
export const LABEL_PX = 13
export const SUBLABEL_PX = 11
export const EDGE_LABEL_PX = 11
export const LINE_H = 16
export const SUB_H = 14
const PAD_Y = 16
const MIN_W = 64

/** Text width in px. */
export type Measure = (text: string, px: number) => number

/** Greedy word wrap at `width` characters, at most `maxLines` lines, `…` when truncated. */
export function wrapLabel(text: string, width = WRAP, maxLines = 2): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (let word of words) {
    while (word.length > width) {
      if (cur) lines.push(cur)
      lines.push(word.slice(0, width))
      word = word.slice(width)
      cur = ''
    }
    if (!cur) cur = word
    else if (cur.length + 1 + word.length <= width) cur += ` ${word}`
    else {
      lines.push(cur)
      cur = word
    }
  }
  if (cur) lines.push(cur)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  const last = kept[maxLines - 1]!
  kept[maxLines - 1] = `${last.length >= width ? last.slice(0, width - 1) : last}…`
  return kept
}

/** Extra room each shape needs around its text box. */
const SHAPE_PAD: Record<GraphNode['shape'], { w: number; h: number; top: number }> = {
  box: { w: 0, h: 0, top: 0 },
  store: { w: 0, h: 14, top: 10 },
  actor: { w: 0, h: 30, top: 30 },
  queue: { w: 8, h: 8, top: 0 },
  decision: { w: 40, h: 28, top: 14 },
  note: { w: 12, h: 0, top: 0 },
}

export interface NodeText {
  lines: string[]
  sublabel?: string
  /** Y offset of the first text line from the node's top. */
  top: number
}

export function nodeText(node: Pick<GraphNode, 'label' | 'sublabel' | 'shape'>): NodeText {
  const sub = node.sublabel ? wrapLabel(node.sublabel, WRAP, 1)[0] : undefined
  return { lines: wrapLabel(node.label), ...(sub ? { sublabel: sub } : {}), top: SHAPE_PAD[node.shape].top + PAD_Y / 2 }
}

export function nodeSize(node: Pick<GraphNode, 'label' | 'sublabel' | 'shape'>, measure: Measure): { width: number; height: number } {
  const t = nodeText(node)
  const widths = [...t.lines.map((l) => measure(l, LABEL_PX)), ...(t.sublabel ? [measure(t.sublabel, SUBLABEL_PX)] : [])]
  const pad = SHAPE_PAD[node.shape]
  return {
    width: Math.ceil(Math.max(MIN_W, Math.max(...widths) + 24 + pad.w)),
    height: Math.ceil(t.lines.length * LINE_H + (t.sublabel ? SUB_H : 0) + PAD_Y + pad.h),
  }
}

/** Extra nodes created by `add` animation actions (§11); placed as boxes, linked from `parent` when it is a node. */
export interface AddedNode {
  id: string
  label: string
  parent?: string
}

/** ELK input for a graph IR (plus nodes added by an animation). Groups are compound nodes of size 0. */
export function graphLayoutInput(ir: GraphIR, measure: Measure, added: readonly AddedNode[] = []): LayoutGraphInput {
  const groupIds = new Set(ir.groups.map((g) => g.id))
  const nodeIds = new Set(ir.nodes.map((n) => n.id))
  return {
    algorithm: 'layered',
    direction: ir.direction,
    nodes: [
      ...ir.groups.map((g) => ({ id: g.id, width: 0, height: 0, ...(g.parent && groupIds.has(g.parent) ? { parent: g.parent } : {}) })),
      ...ir.nodes.map((n) => ({ id: n.id, ...nodeSize(n, measure), ...(n.group && groupIds.has(n.group) ? { parent: n.group } : {}) })),
      ...added.map((a) => ({
        id: a.id,
        ...nodeSize({ label: a.label, shape: 'box' }, measure),
        ...(a.parent && groupIds.has(a.parent) ? { parent: a.parent } : {}),
      })),
    ],
    edges: [
      ...ir.edges.map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        ...(e.label ? { label: { width: Math.ceil(measure(e.label, EDGE_LABEL_PX) + 8), height: 14 } } : {}),
      })),
      ...added
        .filter((a) => a.parent && nodeIds.has(a.parent))
        .map((a) => ({ id: `${a.parent}->${a.id}`, from: a.parent!, to: a.id })),
    ],
  }
}

let canvasCtx: CanvasRenderingContext2D | null | undefined

/** Canvas `measureText` in the theme font; falls back to 0.6 em per character without a canvas. */
export function canvasMeasure(fontFamily: string): Measure {
  if (canvasCtx === undefined) {
    try {
      canvasCtx = typeof OffscreenCanvas !== 'undefined'
        ? (new OffscreenCanvas(1, 1).getContext('2d') as unknown as CanvasRenderingContext2D | null)
        : null
    } catch {
      canvasCtx = null
    }
  }
  const ctx = canvasCtx
  return (text, px) => {
    if (!ctx) return text.length * px * 0.6
    ctx.font = `${px}px ${fontFamily}`
    return ctx.measureText(text).width
  }
}
