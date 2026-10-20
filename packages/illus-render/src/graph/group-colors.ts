import type { GraphColor, GraphGroup, GraphIR } from '@illus/core'

import { GROUP_COLOR_ORDER } from './palette.ts'

/**
 * Presentation-only colours; never writes defaults back into grounded IR. Explicit colours are
 * reserved up front. Parents and earlier siblings resolve first, even for child-before-parent IR.
 */
export function assignGroupColors(ir: Pick<GraphIR, 'groups' | 'nodes'>): {
  groups: Map<string, GraphColor>
  nodes: Map<string, GraphColor>
} {
  const byId = new Map(ir.groups.map((g) => [g.id, g]))
  const families = new Map<string | undefined, GraphGroup[]>()
  const siblingColors = new Map<string | undefined, Set<GraphColor>>()
  const resolved = new Map<string, GraphColor>()
  const explicit = new Set<GraphColor>()
  for (const g of ir.groups) {
    const siblings = families.get(g.parent) ?? []
    siblings.push(g)
    families.set(g.parent, siblings)
    const used = siblingColors.get(g.parent) ?? new Set<GraphColor>()
    if (g.color) {
      used.add(g.color)
      explicit.add(g.color)
      resolved.set(g.id, g.color)
    }
    siblingColors.set(g.parent, used)
  }
  for (const n of ir.nodes) if (n.color) explicit.add(n.color)
  const used = new Set(explicit)
  const resolving = new Set<string>()
  const resolve = (g: GraphGroup): GraphColor | undefined => {
    if (resolved.has(g.id)) return resolved.get(g.id)
    // Structural validation rejects cycles; keep this presentation helper bounded for stale IR.
    if (resolving.has(g.id)) return undefined
    resolving.add(g.id)
    const parent = g.parent ? byId.get(g.parent) : undefined
    const parentColor = parent ? resolve(parent) : undefined
    const siblings = families.get(g.parent)!
    for (const earlier of siblings) {
      if (earlier.id === g.id) break
      resolve(earlier)
    }
    const taken = siblingColors.get(g.parent)!
    let available = GROUP_COLOR_ORDER.filter(
      (c) => c !== parentColor && !taken.has(c),
    )
    // Once siblings exhaust the palette, reuse is unavoidable, but an auto child still differs
    // from its parent. Explicit parent/child collisions remain exactly as authored.
    if (!available.length)
      available = GROUP_COLOR_ORDER.filter((c) => c !== parentColor)
    const unreserved = available.filter((c) => !explicit.has(c))
    if (unreserved.length) available = unreserved
    const color = available.find((c) => !used.has(c)) ?? available[0]!
    resolved.set(g.id, color)
    taken.add(color)
    used.add(color)
    resolving.delete(g.id)
    return color
  }
  for (const g of ir.groups) resolve(g)
  const groups = new Map(ir.groups.map((g) => [g.id, resolved.get(g.id)!]))
  const nodes = new Map<string, GraphColor>()
  for (const n of ir.nodes) {
    const color = n.color ?? (n.group ? groups.get(n.group) : undefined)
    if (color) nodes.set(n.id, color)
  }
  return { groups, nodes }
}
