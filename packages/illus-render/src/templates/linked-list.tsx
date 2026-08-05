// `linked-list` template (§10): nodes with next (and prev) links, head/tail, an optional cycle.
import { z } from 'zod'

import type { TemplateViewProps } from '../types.ts'

import { Arrow, BASE_ACTIONS, BOTTOM, Cell, Decor, defineTemplate, duplicates, Id, Kit, listPath, PAD, PtrName, ptrPaths, T, TemplateDropError, TemplateSvg, Text, textW, TOP, Val, without } from './kit.tsx'
import type { Box, Pt } from './kit.tsx'

const Props = z.object({
  label: Text.optional(),
  nodes: z.array(z.object({ id: Id, value: Val })).min(1).max(10),
  doubly: z.boolean().optional(),
  head: Id.optional(),
  tail: Id.optional(),
  cycleTo: Id.optional(),
  pointers: z.array(z.object({ name: PtrName, node: Id })).max(4).optional(),
})
type Props = z.infer<typeof Props>
type Node = { id: string; value: string | number; path: string }
interface Layout {
  width: number
  height: number
  boxes: Map<string, Box>
}

const H = 34
const GAP = 40

function place(nodes: readonly Node[], hasLabel: boolean): Layout {
  const boxes = new Map<string, Box>()
  let x = PAD
  const y = TOP + (hasLabel ? 18 : 0) + 30
  for (const n of nodes) {
    const w = Math.max(44, textW(n.value, 13, true) + 22)
    boxes.set(n.id, { x, y, w, h: H })
    x += w + GAP
  }
  return { width: x - GAP + PAD + 40, height: y + H + 44 + BOTTOM, boxes }
}

const nodesOf = (p: Props): Node[] => p.nodes.map((n, i) => ({ ...n, path: `nodes.${i}` }))
const layout = (p: Props) => place(nodesOf(p), !!p.label)

/** Default next of each node: the following node; the last one points at `cycleTo` or null. */
function nextOf(nodes: readonly Node[], cycleTo: string | undefined): Map<string, string | null> {
  return new Map(nodes.map((n, i) => [n.id, nodes[i + 1]?.id ?? cycleTo ?? null]))
}

function LinkedListView({ ir, props: p, layout: base, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const kit = new Kit(ir, frame, initialFrame(p), { head: 'head', tail: 'tail', ...ptrPaths(p.pointers) })
  // `add` inserts after its parent (or at the front without one).
  const nodes = nodesOf(p)
  for (const a of kit.added()) {
    const at = a.parent ? nodes.findIndex((n) => n.id === a.parent) + 1 : 0
    nodes.splice(at || (a.parent ? nodes.length : 0), 0, { id: a.id, value: a.label, path: `added.${a.id}` })
  }
  const L = kit.added().length ? place(nodes, !!p.label) : base
  const next = nextOf(nodes, p.cycleTo)
  const nextNow = (id: string): string | null => {
    const v = kit.frame?.values[`edge:next-${id}`]
    if (v === undefined) return next.get(id) ?? null
    return v === 'null' || v === '' ? null : String(v)
  }
  const order = nodes.map((n) => n.id)
  const link = (from: string, to: string | null, kind: 'next' | 'prev') => {
    const a = L.boxes.get(from)
    if (!a) return null
    const t = `edge:${kind}-${from}`
    if (to === null) {
      if (kind === 'prev') return null
      const pts: Pt[] = [
        [a.x + a.w, a.y + H / 2],
        [a.x + a.w + 22, a.y + H / 2],
      ]
      kit.line(`next-${from}`, pts)
      return (
        <g key={t} {...kit.el(`${nodes.find((n) => n.id === from)!.path}`, t)}>
          <path d={`M${pts[0]!.join(',')} L${pts[1]!.join(',')}`} className="t-link" />
          <T x={a.x + a.w + 30} y={a.y + H / 2} cls="t-small" anchor="start">
            null
          </T>
        </g>
      )
    }
    const b = L.boxes.get(to)
    if (!b) return null
    const adjacent = order.indexOf(to) === order.indexOf(from) + (kind === 'next' ? 1 : -1)
    let pts: Pt[]
    let curve = 0
    if (adjacent && kind === 'next') pts = [[a.x + a.w, a.y + H / 2 - 5], [b.x, b.y + H / 2 - 5]]
    else if (adjacent) pts = [[a.x, a.y + H / 2 + 7], [b.x + b.w, b.y + H / 2 + 7]]
    else {
      // Back-links and skips arc below the row.
      pts = [[a.x + a.w / 2, a.y + H], [b.x + b.w / 2, b.y + H]]
      curve = order.indexOf(to) < order.indexOf(from) ? -36 : 36
      if (kind === 'prev') curve = -curve
    }
    kit.line(`${kind}-${from}`, pts)
    const isCycle = kind === 'next' && p.cycleTo === to && from === p.nodes[p.nodes.length - 1]!.id
    return (
      <g key={t} {...kit.el(isCycle ? 'cycleTo' : nodes.find((n) => n.id === from)!.path, t)}>
        <Arrow pts={pts} curve={curve} dashed={kind === 'prev'} />
      </g>
    )
  }
  return (
    <TemplateSvg width={L.width} height={L.height} label={p.label ?? 'linked list'} onReady={onReady}>
      {p.label && (
        <T x={PAD} y={TOP - 4} cls="t-cap" anchor="start">
          {p.label}
        </T>
      )}
      {nodes.map((n) => {
        const t = `node:${n.id}`
        const b = kit.at(t, L.boxes.get(n.id)!)
        return (
          <g key={n.id} {...kit.el(n.path, t)}>
            <Cell box={b} text={kit.content(t, (el) => nodes.find((m) => `node:${m.id}` === el)?.value ?? '')} rx={6} />
          </g>
        )
      })}
      {nodes.map((n) => link(n.id, nextNow(n.id), 'next'))}
      {p.doubly && nodes.map((n, i) => (i > 0 ? link(n.id, nodes[i - 1]!.id, 'prev') : null))}
      <Decor kit={kit} />
    </TemplateSvg>
  )
}

function initialFrame(p: Props) {
  const ids = new Set(p.nodes.map((n) => n.id))
  const ptrs: [string, string][] = []
  if (p.head && ids.has(p.head)) ptrs.push(['head', p.head])
  if (p.tail && ids.has(p.tail)) ptrs.push(['tail', p.tail])
  for (const x of p.pointers ?? []) if (ids.has(x.node)) ptrs.push([x.name, x.node])
  return { pointers: Object.fromEntries(ptrs.map(([k, id]) => [k, `node:${id}` as const])) }
}

function checkInvariants(p: Props): string[] {
  const out: string[] = []
  const ids = new Set(p.nodes.map((n) => n.id))
  for (const d of duplicates(p.nodes.map((n) => n.id))) out.push(`node id ${d} is used twice`)
  if (p.head && p.head !== p.nodes[0]!.id) out.push(`head ${p.head} must be the first node (${p.nodes[0]!.id})`)
  if (p.tail && p.tail !== p.nodes[p.nodes.length - 1]!.id) out.push(`tail ${p.tail} must be the last node`)
  if (p.cycleTo && !ids.has(p.cycleTo)) out.push(`cycleTo ${p.cycleTo} does not exist`)
  for (const x of p.pointers ?? []) if (!ids.has(x.node)) out.push(`pointer ${x.name} targets missing node ${x.node}`)
  for (const d of duplicates([...(p.head ? ['head'] : []), ...(p.tail ? ['tail'] : []), ...(p.pointers ?? []).map((x) => x.name)]))
    out.push(`pointer ${d} is declared twice`)
  return out
}

export const linkedListTemplate = defineTemplate<Props, Layout>({
  id: 'linked-list',
  description: 'A singly or doubly linked list: nodes in list order with next (and prev) links, head and tail markers, named node pointers and an optional cycle from the last node back to an earlier one.',
  whenToUse: 'Use for linked lists and pointer-chasing algorithms: insertion and deletion, reversal, fast/slow pointers, cycle detection, LRU lists. Nodes are listed in list order. At most 10 nodes.',
  propsSchema: Props,
  example: {
    label: 'list with a cycle',
    nodes: [
      { id: 'n1', value: 3 },
      { id: 'n2', value: 7 },
      { id: 'n3', value: 1 },
      { id: 'n4', value: 9 },
      { id: 'n5', value: 4 },
    ],
    head: 'n1',
    cycleTo: 'n3',
    pointers: [
      { name: 'slow', node: 'n2' },
      { name: 'fast', node: 'n3' },
    ],
  },
  exampleEvidence: [
    { path: 'nodes', evidence: { blockId: 'b-floyd-1', quote: 'a linked list whose last node points back to an earlier node' } },
    { path: 'cycleTo', evidence: { blockId: 'b-floyd-1', quote: 'points back to an earlier node, forming a cycle' } },
    { path: 'pointers.0', evidence: { blockId: 'b-floyd-2', quote: 'the slow pointer advances one node at a time' } },
    { path: 'pointers.1', evidence: { blockId: 'b-floyd-2', quote: 'the fast pointer advances two nodes' } },
  ],
  evidencePaths: '`nodes` or `nodes.<i>`, `head`, `tail`, `cycleTo`, `pointers.<k>`.',
  targetsDoc: '`node:<id>` for a node; `edge:next-<id>` for the next link leaving node <id> (`set` it to another node id, or "null", to relink); `edge:prev-<id>` when doubly linked. `add` inserts after its `parent` node. Pointers (head, tail, slow…) move between `node:<id>` targets.',
  targets: (p) => [
    ...p.nodes.map((n) => `node:${n.id}`),
    ...p.nodes.flatMap((n, i) => (i < p.nodes.length - 1 || p.cycleTo ? [`edge:next-${n.id}`] : [])),
    ...(p.doubly ? p.nodes.slice(1).map((n) => `edge:prev-${n.id}`) : []),
  ],
  supportedActions: [...BASE_ACTIONS, 'add', 'remove', 'set', 'pointer', 'token'],
  initialFrame,
  checkInvariants,
  dropElement(p, path) {
    const lp = listPath(path)
    if (lp?.list === 'pointers' && !lp.rest && p.pointers) return { ...p, pointers: without(p.pointers, lp.index) }
    if (lp?.list === 'nodes' && !lp.rest && p.nodes.length > 1) {
      const id = p.nodes[lp.index]?.id
      const { head, tail, cycleTo, ...rest } = p
      const nodes = without(p.nodes, lp.index)
      return {
        ...rest,
        nodes,
        ...(head ? { head: nodes[0]!.id } : {}),
        ...(tail ? { tail: nodes[nodes.length - 1]!.id } : {}),
        ...(cycleTo && cycleTo !== id ? { cycleTo } : {}),
        ...(p.pointers ? { pointers: p.pointers.filter((x) => x.node !== id) } : {}),
      }
    }
    throw new TemplateDropError('linked-list', path)
  },
  layout,
  Component: LinkedListView,
})
