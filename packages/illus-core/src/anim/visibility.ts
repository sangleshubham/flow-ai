import type { FrameState, Target } from '../schemas/animation.ts'
import type { IR } from '../schemas/ir.ts'

/** Derive the drawn visibility of endpoint edges/messages, graph groups, and travelling tokens.
 * Keeps the original frame identity when nothing changes; never mutates precomputed frames. */
export function withDerivedVisibility(ir: IR, frame: FrameState): FrameState {
  let edges: readonly { id: string; from: string; to: string }[]
  switch (ir.type) {
    case 'graph':
      edges = ir.edges
      break
    case 'state':
      edges = ir.transitions
      break
    case 'class':
      edges = ir.relations
      break
    case 'er':
      edges = ir.relationships
      break
    case 'sequence':
      edges = ir.messages
      break
    default:
      return frame
  }
  const hidden = new Set(frame.hidden)
  const removed = new Set(frame.removed)
  for (const edge of edges) {
    const from: Target = `node:${edge.from}`
    const to: Target = `node:${edge.to}`
    const target: Target =
      ir.type === 'sequence' ? `msg:${edge.id}` : `edge:${edge.id}`
    if (hidden.has(from) || hidden.has(to)) hidden.add(target)
    else if (removed.has(from) || removed.has(to)) removed.add(target)
  }
  if (ir.type === 'graph') {
    const parents = new Map(ir.groups.map((group) => [group.id, group.parent]))
    const members = new Map<string, string[]>()
    for (const node of ir.nodes) {
      const seen = new Set<string>()
      let group = node.group
      while (group && !seen.has(group)) {
        seen.add(group)
        const nodes = members.get(group) ?? []
        nodes.push(node.id)
        members.set(group, nodes)
        group = parents.get(group)
      }
    }
    for (const group of ir.groups) {
      const nodes = members.get(group.id)
      if (nodes?.length && nodes.every((id) => hidden.has(`node:${id}`)))
        hidden.add(`group:${group.id}`)
    }
  }
  const tokens = frame.tokens.filter(
    (token) => !token.path.some((id) => hidden.has(`edge:${id}`)),
  )
  const hiddenChanged =
    hidden.size !== frame.hidden.length ||
    [...hidden].some((target, i) => target !== frame.hidden[i])
  const removedChanged =
    removed.size !== frame.removed.length ||
    [...removed].some((target, i) => target !== frame.removed[i])
  if (
    !hiddenChanged &&
    !removedChanged &&
    tokens.length === frame.tokens.length
  )
    return frame
  return {
    ...frame,
    hidden: hiddenChanged ? [...hidden] : frame.hidden,
    removed: removedChanged ? [...removed] : frame.removed,
    tokens: tokens.length === frame.tokens.length ? frame.tokens : tokens,
  }
}
