// Parent-pointer trees shared by `tree` and `call-tree`: structural checks and d3-hierarchy layout (§10).
import { hierarchy, tree } from 'd3-hierarchy'

import { duplicates } from './kit.tsx'

export interface ParentNode {
  id: string
  parent?: string | undefined
}

/** Unique ids, exactly one root, parents exist, no cycles. */
export function checkParents(nodes: readonly ParentNode[]): string[] {
  const out: string[] = []
  const ids = new Set(nodes.map((n) => n.id))
  for (const d of duplicates(nodes.map((n) => n.id))) out.push(`id ${d} is used twice`)
  const roots = nodes.filter((n) => !n.parent)
  if (roots.length !== 1) out.push(`expected exactly one root (a node without parent), found ${roots.length}`)
  for (const n of nodes) if (n.parent && !ids.has(n.parent)) out.push(`${n.id}: parent ${n.parent} does not exist`)
  const parent = new Map(nodes.map((n) => [n.id, n.parent]))
  for (const n of nodes) {
    const seen = new Set<string>()
    for (let c: string | undefined = n.id; c; c = parent.get(c)) {
      if (seen.has(c)) {
        out.push(`${n.id}: its parent chain loops`)
        break
      }
      seen.add(c)
    }
  }
  return out
}

/** The node and all its descendants. */
export function subtree(nodes: readonly ParentNode[], id: string): Set<string> {
  const out = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const n of nodes)
      if (n.parent && out.has(n.parent) && !out.has(n.id)) {
        out.add(n.id)
        grew = true
      }
  }
  return out
}

export interface TreePlace {
  x: number
  y: number
  depth: number
}

interface Datum {
  id: string | null
  children: Datum[]
}

/**
 * Tidy tree layout (d3-hierarchy `tree()`), deterministic. `childrenOf` returns child ids in order;
 * `null` entries are placeholders that keep a lone binary child on its side and are not returned.
 * Returns the top-left-based centre of each node.
 */
export function layoutTree(
  rootId: string,
  childrenOf: (id: string) => readonly (string | null)[],
  width: (id: string) => number,
  opts: { gap?: number; levelH?: number } = {},
): { places: Map<string, TreePlace>; width: number; height: number } {
  const gap = opts.gap ?? 14
  const levelH = opts.levelH ?? 66
  const build = (id: string | null, depth: number): Datum => ({
    id,
    children: id === null || depth > 40 ? [] : childrenOf(id).map((c) => build(c, depth + 1)),
  })
  const w = (d: Datum) => (d.id === null ? 30 : width(d.id))
  const root = tree<Datum>()
    .nodeSize([1, levelH])
    .separation((a, b) => (w(a.data) + w(b.data)) / 2 + gap)(hierarchy(build(rootId, 0), (d) => d.children))
  const all = root.descendants()
  const minX = Math.min(...all.map((n) => n.x - w(n.data) / 2))
  const maxX = Math.max(...all.map((n) => n.x + w(n.data) / 2))
  const places = new Map<string, TreePlace>()
  for (const n of all) if (n.data.id !== null) places.set(n.data.id, { x: n.x - minX, y: n.y, depth: n.depth })
  return { places, width: maxX - minX, height: Math.max(...all.map((n) => n.y)) }
}
