import { AnimationIR } from '../schemas/animation.ts'
import type { Action } from '../schemas/animation.ts'
import type { GraphIR, GraphNode } from '../schemas/ir.ts'

/** Kahn order, choosing the first remaining IR node whenever a cycle blocks progress. */
function flowOrder(ir: GraphIR): GraphNode[] {
  const remaining = new Set(ir.nodes.map((node) => node.id))
  const incoming = new Map(ir.nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(ir.nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of ir.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
    outgoing.get(edge.from)?.push(edge.to)
  }
  const ordered: GraphNode[] = []
  while (remaining.size) {
    const ready = ir.nodes.find(
      (node) => remaining.has(node.id) && incoming.get(node.id) === 0,
    )
    const node = ready ?? ir.nodes.find((node) => remaining.has(node.id))!
    ordered.push(node)
    remaining.delete(node.id)
    for (const id of outgoing.get(node.id)!)
      incoming.set(id, incoming.get(id)! - 1)
  }
  return ordered
}

function narration(nodes: readonly GraphNode[]): string {
  const items = nodes.map((node) =>
    node.sublabel ? `${node.label}: ${node.sublabel}` : node.label,
  )
  // Validated labels/sublabels are at most 40 chars each, so the first whole item always fits.
  let text = items[0]!
  for (const item of items.slice(1)) {
    if (text.length + 2 + item.length > 140) break
    text += `; ${item}`
  }
  return text
}

/**
 * A deterministic reveal-in-flow-order animation for a validated graph, used when the animator fails
 * (ADR 0050). Null for graphs with fewer than 3 nodes. Each step cites its first node's grounded evidence.
 */
export function defaultStoryboard(
  ir: GraphIR,
  planItemId: string,
): AnimationIR | null {
  if (ir.nodes.length < 3) return null
  const nodes = flowOrder(ir)
  const size = nodes.length <= 8 ? 1 : 2
  const first = new Set(nodes.slice(0, size).map((node) => node.id))
  const steps: AnimationIR['steps'] = []
  for (let offset = 0; offset < nodes.length; offset += size) {
    const chunk = nodes.slice(offset, offset + size)
    const actions: Action[] = offset
      ? [{ op: 'unhighlight', target: 'all' }]
      : []
    for (const node of chunk) {
      const target = `node:${node.id}` as const
      if (offset) actions.push({ op: 'reveal', target })
      actions.push({ op: 'highlight', target, tone: 'focus' })
    }
    if (offset + size >= nodes.length)
      actions.push({ op: 'unhighlight', target: 'all' })
    steps.push({
      id: `storyboard-${steps.length + 1}`,
      narration: narration(chunk),
      evidence: chunk[0]!.evidence,
      actions,
    })
  }
  return AnimationIR.parse({
    planItemId,
    initialHidden: ir.nodes
      .filter((node) => !first.has(node.id))
      .map((node) => `node:${node.id}`),
    steps,
  })
}
