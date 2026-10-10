// A section's view of a concept model (§13 "Rendering a section's view" and "Layout stability"): what to
// draw, which ids are new, what fades out, focus mode, and ELK hints from the stored layout.
import { emptyFrame } from '@illus/core'
import type { ConceptModel, FrameState, GraphEdge, GraphIR, GraphNode, LayoutGraphFn, LayoutGraphResult, LayoutPoint, Target } from '@illus/core'

import { applyPatches, findElement, toIR } from './apply.ts'
import type { AppliedPatch, ModelElement, ModelIR, ModelState } from './apply.ts'

/** Past this many graph nodes the view switches to focus mode (§13). */
export const FOCUS_THRESHOLD = 24

export interface SectionViewOptions {
  /** Toggle "only this section's additions": S's added/updated elements plus the endpoints they need. */
  onlyNew?: boolean
  /** Toggle "show full model": never switch to focus mode. */
  fullModel?: boolean
  title?: string
  direction?: GraphIR['direction']
}

export interface SectionView {
  /** Model at S (patches with ordinal ≤ S) plus the elements S removed, so they can fade out. */
  ir: ModelIR
  /** Added or updated by S: `VisualSpec.newIds`, drawn with the "new" accent. */
  newIds: string[]
  /** Removed by S: present in `ir` and listed in `frame.removed` so renderers fade them out. */
  removedIds: string[]
  /** Static frame for `<VisualView frame>`: S's removals and annotations. */
  frame: FrameState
  /** S's patch, when it has one. */
  patch: AppliedPatch | undefined
  /** Focus mode is on: hidden nodes are collapsed into `collapsed[placeholderId]`. */
  focus: boolean
  collapsed: Record<string, string[]>
}

const TARGET: Record<ModelElement['type'], 'node' | 'edge' | 'group' | 'msg'> = {
  node: 'node',
  edge: 'edge',
  group: 'group',
  participant: 'node',
  message: 'msg',
  state: 'node',
  transition: 'edge',
}

const endpointsOf = (e: ModelElement): string[] =>
  e.type === 'edge' || e.type === 'message' || e.type === 'transition' ? [e.item.from, e.item.to] : e.type === 'node' && e.item.group ? [e.item.group] : []

/** The view of `model` at the section with ordinal `sectionOrdinal`. */
export function sectionView(model: ConceptModel, sectionOrdinal: number, opts: SectionViewOptions = {}): SectionView {
  const { state, patches } = applyPatches(model, sectionOrdinal)
  const patch = patches.find((p) => p.sectionOrdinal === sectionOrdinal)
  const newIds = patch ? [...patch.added, ...patch.updated] : []

  // Removed elements come back from the state before S so they can fade out.
  let shown: ModelState = state
  const removedIds = patch?.removed ?? []
  if (removedIds.length) {
    const before = applyPatches(model, sectionOrdinal - 1).state
    const back = before.elements.filter((e) => removedIds.includes(e.item.id) && !findElement(state, e.item.id))
    shown = { ...state, elements: [...state.elements, ...back] }
  }

  if (opts.onlyNew) {
    const keep = new Set([...newIds, ...removedIds])
    for (const e of shown.elements) if (keep.has(e.item.id)) for (const id of endpointsOf(e)) keep.add(id)
    shown = { ...shown, elements: shown.elements.filter((e) => keep.has(e.item.id)) }
  }

  let ir = toIR(shown, opts.title ?? model.conceptId, opts.direction)
  let collapsed: Record<string, string[]> = {}
  const focus = !opts.fullModel && !opts.onlyNew && ir.type === 'graph' && ir.nodes.length > FOCUS_THRESHOLD
  if (focus) ({ ir, collapsed } = focusGraph(ir as GraphIR, new Set([...newIds, ...(patch?.annotated ?? [])])))

  const target = (id: string): Target | undefined => {
    const e = shown.elements.find((x) => x.item.id === id)
    return e && (`${TARGET[e.type]}:${id}` as Target)
  }
  const frame = emptyFrame()
  frame.removed = removedIds.flatMap((id) => target(id) ?? [])
  const ids = new Set(irIds(ir))
  for (const a of state.annotations) if (patch?.annotated.includes(a.id) && ids.has(a.id)) frame.annotations[`${target(a.id)}`] = a.text
  return { ir, newIds: newIds.filter((id) => ids.has(id)), removedIds: removedIds.filter((id) => ids.has(id)), frame, patch, focus, collapsed }
}

function irIds(ir: ModelIR): string[] {
  if (ir.type === 'graph') return [...ir.nodes, ...ir.edges, ...ir.groups].map((e) => e.id)
  if (ir.type === 'sequence') return [...ir.participants, ...ir.messages].map((e) => e.id)
  return [...ir.states, ...ir.transitions].map((e) => e.id)
}

/**
 * Focus mode (§13): S's new nodes plus one hop of neighbours; every other node is collapsed into one
 * "N more" placeholder per group (one more for ungrouped nodes). Edges to hidden nodes go to the placeholder.
 */
export function focusGraph(ir: GraphIR, focusIds: ReadonlySet<string>): { ir: GraphIR; collapsed: Record<string, string[]> } {
  const centre = new Set(ir.nodes.filter((n) => focusIds.has(n.id)).map((n) => n.id))
  for (const e of ir.edges) if (focusIds.has(e.id)) centre.add(e.from).add(e.to)
  if (!centre.size) return { ir, collapsed: {} }
  const visible = new Set(centre)
  for (const e of ir.edges) {
    if (centre.has(e.from)) visible.add(e.to)
    if (centre.has(e.to)) visible.add(e.from)
  }
  const placeholderOfGroup = new Map<string, string>()
  const placeholderOf = new Map<string, string>()
  const collapsed: Record<string, string[]> = {}
  const nodes: GraphNode[] = []
  const extra: GraphNode[] = []
  for (const n of ir.nodes) {
    if (visible.has(n.id)) {
      nodes.push(n)
      continue
    }
    const key = n.group ?? ''
    let id = placeholderOfGroup.get(key)
    if (!id) {
      id = `more-${placeholderOfGroup.size + 1}`
      placeholderOfGroup.set(key, id)
      const group = ir.groups.find((g) => g.id === n.group)
      extra.push({ id, label: '', shape: 'note', evidence: group?.evidence ?? n.evidence, ...(n.group && { group: n.group }) })
      collapsed[id] = []
    }
    collapsed[id]!.push(n.id)
    placeholderOf.set(n.id, id)
  }
  for (const p of extra) p.label = `${collapsed[p.id]!.length} more`
  const at = (id: string) => (visible.has(id) ? id : placeholderOf.get(id)!)
  const seen = new Set<string>()
  const edges: GraphEdge[] = []
  for (const e of ir.edges) {
    const from = at(e.from)
    const to = at(e.to)
    if (from === to || (!visible.has(e.from) && !visible.has(e.to))) continue
    const key = `${from}>${to}`
    if (seen.has(key)) continue
    seen.add(key)
    const { label: _l, ...rest } = e
    edges.push(from === e.from && to === e.to ? e : { ...rest, from, to })
  }
  const used = new Set([...nodes, ...extra].flatMap((n) => (n.group ? [n.group] : [])))
  for (const g of ir.groups) if (used.has(g.id) && g.parent) used.add(g.parent)
  return { ir: { ...ir, nodes: [...nodes, ...extra], edges, groups: ir.groups.filter((g) => used.has(g.id)) }, collapsed }
}

/**
 * `<VisualView layoutGraph>` for a concept model (§13 layout stability): stored positions become ELK hints,
 * which switch W4's `layoutGraph` to INTERACTIVE layering and crossing minimisation. New nodes get hints
 * too (four placements are tried, including W4's own; the one that moves existing nodes least wins), and the result is shifted
 * so existing nodes stay where they were on average. Hints the renderer passes itself (previous frame) win.
 */
export function conceptLayoutGraph(model: Pick<ConceptModel, 'layout'>, base: LayoutGraphFn): LayoutGraphFn {
  return async (input, opts) => {
    const ids = new Set(input.nodes.map((n) => n.id))
    const stored = Object.fromEntries(Object.entries(model.layout ?? {}).filter(([id]) => ids.has(id))) as Record<string, LayoutPoint>
    if (!Object.keys(stored).length) return shift(await base(input, opts), HEADROOM.x, HEADROOM.y)
    const known = { ...stored, ...input.hints }
    // ponytail: four ELK runs per relayout; add placements here if a book shows worse drift.
    const tries = await Promise.allSettled(
      [placeNew(input, known, 'below'), placeNew(input, known, 'above'), placeNew(input, known, 'beside'), known].map((hints) => base({ ...input, hints }, opts)),
    )
    if (opts?.signal?.aborted) throw opts.signal.reason
    const ok = tries.flatMap((t) => (t.status === 'fulfilled' ? [anchor(t.value, stored)] : []))
    // A layout engine that rejects hints must not cost the reader the diagram: lay out from scratch.
    if (!ok.length) return base(input, opts)
    const parents = new Set(input.nodes.flatMap((n) => (n.parent ? [n.parent] : [])))
    const leaves = Object.fromEntries(Object.entries(stored).filter(([id]) => !parents.has(id)))
    const moved = (r: LayoutGraphResult) => meanDisplacement(leaves, r.nodes)
    return ok.reduce((best, r) => (moved(r) < moved(best) ? r : best))
  }
}

/**
 * Room left before and above a model's first layout, so later back-edge routes need not push existing
 * nodes right or down (§13). Tuned on the 5-section fixture (ADR 0044).
 */
export const HEADROOM = { x: 48, y: 96 } as const

/**
 * ELK's coordinates float: a new back edge can open an empty band above the whole drawing. Shifts the layout
 * so the stored nodes are, on average, where they were, without pushing anything below 0.
 */
export function anchor(r: LayoutGraphResult, stored: Record<string, LayoutPoint>): LayoutGraphResult {
  const shared = Object.keys(stored).filter((id) => r.nodes[id])
  if (!shared.length) return r
  const points = [...Object.values(r.nodes), ...Object.values(r.edges).flatMap((e) => [...e.points, ...(e.label ? [e.label] : [])])]
  const minX = Math.min(...points.map((p) => p.x))
  const minY = Math.min(...points.map((p) => p.y))
  const dx = Math.max(-minX, shared.reduce((s, id) => s + stored[id]!.x - r.nodes[id]!.x, 0) / shared.length)
  const dy = Math.max(-minY, shared.reduce((s, id) => s + stored[id]!.y - r.nodes[id]!.y, 0) / shared.length)
  return shift(r, dx, dy)
}

function shift(r: LayoutGraphResult, dx: number, dy: number): LayoutGraphResult {
  const mv = (p: LayoutPoint) => ({ x: p.x + dx, y: p.y + dy })
  return {
    width: r.width + dx,
    height: r.height + dy,
    nodes: Object.fromEntries(Object.entries(r.nodes).map(([id, n]) => [id, { ...n, ...mv(n) }])),
    edges: Object.fromEntries(Object.entries(r.edges).map(([id, e]) => [id, { points: e.points.map(mv), ...(e.label && { label: mv(e.label) }) }])),
  }
}

/**
 * Hints for nodes without a stored position: one layer after the furthest placed neighbour and below every
 * placed node. Edges from a new node back to existing ones then point backwards, so interactive cycle
 * breaking reverses them instead of pushing existing nodes into later layers.
 */
function placeNew(input: Parameters<LayoutGraphFn>[0], known: Record<string, LayoutPoint>, mode: 'below' | 'above' | 'beside'): Record<string, LayoutPoint> {
  const hints = { ...known }
  const parents = new Set(input.nodes.flatMap((n) => (n.parent ? [n.parent] : [])))
  const lr = input.direction === 'LR'
  const along = (p: LayoutPoint) => (lr ? p.x : p.y)
  const across = (p: LayoutPoint) => (lr ? p.y : p.x)
  const extent = (id: string) => {
    const n = input.nodes.find((x) => x.id === id)
    return n ? (lr ? n.width : n.height) : 0
  }
  const at = (a: number, c: number): LayoutPoint => (lr ? { x: a, y: c } : { x: c, y: a })
  let todo = input.nodes.filter((n) => !hints[n.id] && !parents.has(n.id))
  let bottom = Math.max(0, ...Object.values(hints).map(across)) + 60
  let top = Math.min(0, ...Object.values(hints).map(across)) - 60
  const stack = (n: { width: number; height: number }) => {
    const size = (lr ? n.height : n.width) + 24
    if (mode === 'above') return (top -= size) + 24
    bottom += size
    return bottom - size
  }
  while (todo.length) {
    const left = todo.filter((n) => {
      const nbrs = input.edges.flatMap((e) => (e.to === n.id ? [e.from] : e.from === n.id ? [e.to] : [])).filter((id) => hints[id])
      if (!nbrs.length) return true
      hints[n.id] = at(Math.max(...nbrs.map((id) => along(hints[id]!) + extent(id))) + 48, mode === 'beside' ? across(hints[nbrs[0]!]!) + 1 : stack(n))
      return false
    })
    if (left.length === todo.length) {
      // Unconnected to anything placed: after the last layer.
      const end = Math.max(0, ...Object.entries(hints).map(([id, p]) => along(p) + extent(id))) + 48
      for (const n of left) {
        hints[n.id] = at(end, stack(n))
      }
      break
    }
    todo = left
  }
  return hints
}

/** Node positions of a layout, to store in `ConceptModel.layout` after each render (§13). Keeps older positions. */
export function withLayout(model: ConceptModel, layout: LayoutGraphResult): ConceptModel {
  const positions = Object.fromEntries(Object.entries(layout.nodes).map(([id, n]) => [id, { x: n.x, y: n.y }]))
  return { ...model, layout: { ...model.layout, ...positions } }
}

/** Mean distance (px) moved by nodes present in both layouts; 0 when none are shared (§13 target ≤ 40). */
export function meanDisplacement(prev: Record<string, LayoutPoint>, next: Record<string, LayoutPoint>): number {
  const shared = Object.keys(prev).filter((id) => next[id])
  if (!shared.length) return 0
  return shared.reduce((sum, id) => sum + Math.hypot(next[id]!.x - prev[id]!.x, next[id]!.y - prev[id]!.y), 0) / shared.length
}
