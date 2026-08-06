// `tree` template (§10): binary trees, BSTs, heaps (with their array mirror), n-ary trees, tries and B-trees.
import { z } from 'zod'

import type { TemplateViewProps } from '../types.ts'

import { checkParents, layoutTree, subtree } from './hierarchy.ts'
import type { TreePlace } from './hierarchy.ts'
import { BASE_ACTIONS, BOTTOM, Cell, clip, Decor, defineTemplate, Id, Kit, listPath, PAD, T, TemplateDropError, TemplateSvg, Text, textW, TOP, Val } from './kit.tsx'
import type { Box, Pt } from './kit.tsx'

const Variant = z.enum(['binary', 'bst', 'heap-min', 'heap-max', 'nary', 'trie', 'btree'])
const Props = z.object({
  label: Text.optional(),
  variant: Variant,
  nodes: z
    .array(
      z.object({
        id: Id,
        keys: z.array(Val).max(4),
        parent: Id.optional(),
        side: z.enum(['left', 'right']).optional(),
        terminal: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(31),
  showArray: z.boolean().optional(),
})
type Props = z.infer<typeof Props>
type TNode = Props['nodes'][number]
type Variant = z.infer<typeof Variant>

interface Layout {
  width: number
  height: number
  boxes: Map<string, Box>
  heap: string[]
  array: Box[]
}

const H = 32
const BINARY: readonly Variant[] = ['binary', 'bst', 'heap-min', 'heap-max']
const isHeap = (v: Variant) => v === 'heap-min' || v === 'heap-max'
const label = (n: Pick<TNode, 'keys'>, v: Variant) => (v === 'btree' ? n.keys.join(' | ') : n.keys.join(', '))
const nodeW = (n: Pick<TNode, 'keys'>, v: Variant) => Math.max(v === 'trie' ? 30 : 34, textW(label(n, v), 13, true) + (v === 'btree' ? 16 * n.keys.length : 18))

function childrenOf(nodes: readonly TNode[], v: Variant) {
  const by = new Map<string, TNode[]>()
  for (const n of nodes) if (n.parent) by.set(n.parent, [...(by.get(n.parent) ?? []), n])
  return (id: string): (string | null)[] => {
    const kids = by.get(id) ?? []
    if (!BINARY.includes(v) || kids.length === 0) return kids.map((k) => k.id)
    const left = kids.find((k) => k.side === 'left')
    const right = kids.find((k) => k.side === 'right' && k !== left)
    const rest = kids.filter((k) => k !== left && k !== right)
    // A lone child keeps its side; children without a side fill the free sides in order.
    const l = left ?? rest.shift()
    const r = right ?? rest.shift()
    return [l?.id ?? null, r?.id ?? null]
  }
}

/** Level order of a heap: root, then left before right. */
function levelOrder(nodes: readonly TNode[], v: Variant): string[] {
  const root = nodes.find((n) => !n.parent)
  if (!root) return []
  const kids = childrenOf(nodes, v)
  const out: string[] = []
  const q = [root.id]
  while (q.length && out.length <= nodes.length) {
    const id = q.shift()!
    out.push(id)
    for (const c of kids(id)) if (c) q.push(c)
  }
  return out
}

function place(p: Props, nodes: readonly TNode[]): Layout {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const root = nodes.find((n) => !n.parent) ?? nodes[0]!
  const t = layoutTree(root.id, childrenOf(nodes, p.variant), (id) => nodeW(byId.get(id)!, p.variant), { gap: p.variant === 'btree' ? 18 : 14, levelH: 62 })
  const top = TOP + (p.label ? 18 : 0) + 4
  const boxes = new Map<string, Box>()
  for (const [id, pl] of t.places as Map<string, TreePlace>) {
    const w = nodeW(byId.get(id)!, p.variant)
    boxes.set(id, { x: PAD + pl.x - w / 2, y: top + pl.y, w, h: H })
  }
  let height = top + t.height + H + 10
  const heap = p.showArray && isHeap(p.variant) ? levelOrder(nodes, p.variant) : []
  const cw = Math.max(32, ...nodes.map((n) => nodeW(n, p.variant) - 4))
  const array = heap.map((_, i) => ({ x: PAD + i * cw, y: height + 18, w: cw, h: 28 }))
  if (heap.length) height += 18 + 28 + 16
  return { width: Math.max(t.width, heap.length * cw) + PAD * 2, height: height + BOTTOM, boxes, heap, array }
}

const layout = (p: Props) => place(p, p.nodes)

function TreeView({ ir, props: p, layout: base, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const kit = new Kit(ir, frame)
  const nodes: TNode[] = [...p.nodes]
  const paths = new Map(p.nodes.map((n, i) => [n.id, `nodes.${i}`]))
  // `add` attaches a child under `parent` (binary trees fill left, then right).
  for (const a of kit.added()) {
    if (!a.parent || !nodes.some((n) => n.id === a.parent)) continue
    const taken = nodes.filter((n) => n.parent === a.parent).map((n) => n.side)
    const side = BINARY.includes(p.variant) ? (taken.includes('left') ? 'right' : 'left') : undefined
    nodes.push({ id: a.id, keys: [a.label], parent: a.parent, ...(side ? { side } : {}) })
    paths.set(a.id, `added.${a.id}`)
  }
  const L = nodes.length !== p.nodes.length ? place(p, nodes) : base
  const removed = new Set((frame?.removed ?? []).filter((t) => t.startsWith('node:')).map((t) => t.slice(5)))
  const content = (id: string) => kit.content(`node:${id}`, (el) => label(nodes.find((n) => `node:${n.id}` === el) ?? { keys: [] }, p.variant))
  return (
    <TemplateSvg width={L.width} height={L.height} label={p.label ?? `${p.variant} tree`} onReady={onReady}>
      {p.label && (
        <T x={PAD} y={TOP - 4} cls="t-cap" anchor="start">
          {p.label}
        </T>
      )}
      {nodes.map((n) => {
        if (!n.parent) return null
        const a = L.boxes.get(n.parent)
        const b = L.boxes.get(n.id)
        if (!a || !b) return null
        const t = `edge:${n.id}`
        const pts: Pt[] = clip(a, b, 0)
        kit.line(n.id, pts)
        return (
          <g key={t} {...kit.el(paths.get(n.id)!, t, removed.has(n.id) ? 'illus-removed' : '')}>
            <path d={`M${pts[0]!.join(',')} L${pts[1]!.join(',')}`} className="t-link" />
          </g>
        )
      })}
      {nodes.map((n) => {
        const t = `node:${n.id}`
        const b = kit.at(t, L.boxes.get(n.id)!)
        const text = content(n.id)
        return (
          <g key={n.id} {...kit.el(paths.get(n.id)!, t)}>
            <Cell box={b} text={p.variant === 'trie' && text === '' ? '·' : text} rx={p.variant === 'btree' ? 3 : H / 2} />
            {p.variant === 'btree' &&
              n.keys.slice(1).map((_, k) => {
                const x = b.x + ((k + 1) * b.w) / n.keys.length
                return <line key={k} x1={x} x2={x} y1={b.y} y2={b.y + H} className="t-link" />
              })}
            {p.variant === 'trie' && n.terminal && <circle cx={b.x + b.w - 3} cy={b.y + 3} r={4} className="t-head" />}
          </g>
        )
      })}
      {L.heap.length > 0 && (
        <g {...kit.ev('showArray')}>
          <T x={PAD} y={L.array[0]!.y - 8} cls="t-cap" anchor="start">
            array (level order)
          </T>
        </g>
      )}
      {L.heap.map((id, i) => {
        const t = `cell:heap[${i}]`
        const b = kit.at(t, L.array[i]!)
        return (
          <g key={t} {...kit.el(paths.get(id)!, t)}>
            <Cell box={b} text={kit.val(t, content(id))} rx={0} />
            <T x={b.x + b.w / 2} y={b.y + b.h + 8} cls="t-small">
              {i}
            </T>
          </g>
        )
      })}
      <Decor kit={kit} />
    </TemplateSvg>
  )
}

// ---------------------------------------------------------------- invariants

type Key = string | number
const cmp = (a: Key, b: Key) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)))

function checkInvariants(p: Props): string[] {
  const out = checkParents(p.nodes)
  if (out.length) return out
  const v = p.variant
  const byId = new Map(p.nodes.map((n) => [n.id, n]))
  const kids = new Map<string, TNode[]>()
  for (const n of p.nodes) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n])
  const keyTypes = new Set(p.nodes.flatMap((n) => n.keys.map((k) => typeof k)))
  if (keyTypes.size > 1 && v !== 'trie') out.push('keys mix numbers and strings')

  if (BINARY.includes(v)) {
    for (const n of p.nodes) {
      if (n.keys.length !== 1) out.push(`${n.id}: a ${v} node holds exactly one key`)
      if (n.parent && !n.side) out.push(`${n.id}: binary children need a side (left or right)`)
      const ks = kids.get(n.id) ?? []
      if (ks.length > 2) out.push(`${n.id}: has ${ks.length} children; binary nodes have at most 2`)
      for (const s of ['left', 'right'] as const) if (ks.filter((k) => k.side === s).length > 1) out.push(`${n.id}: has two ${s} children`)
    }
    if (out.length) return out
  }
  const root = p.nodes.find((n) => !n.parent)!
  const childOf = (id: string, side: 'left' | 'right') => (kids.get(id) ?? []).find((k) => k.side === side)

  if (v === 'bst') {
    // Each key lies strictly between the bounds inherited from its ancestors.
    const walk = (id: string, lo: Key | undefined, hi: Key | undefined) => {
      const n = byId.get(id)!
      const k = n.keys[0]!
      if ((lo !== undefined && cmp(k, lo) <= 0) || (hi !== undefined && cmp(k, hi) >= 0))
        out.push(`BST order broken at ${id} (key ${k}): must be ${lo !== undefined ? `> ${lo}` : ''}${lo !== undefined && hi !== undefined ? ' and ' : ''}${hi !== undefined ? `< ${hi}` : ''}`)
      const l = childOf(id, 'left')
      const r = childOf(id, 'right')
      if (l) walk(l.id, lo, k)
      if (r) walk(r.id, k, hi)
    }
    walk(root.id, undefined, undefined)
  }
  if (isHeap(v)) {
    // Complete shape: array positions 0..n-1 with children at 2i+1 (left) and 2i+2 (right).
    const pos = new Map<string, number>([[root.id, 0]])
    const q = [root.id]
    while (q.length) {
      const id = q.shift()!
      for (const c of kids.get(id) ?? []) {
        pos.set(c.id, 2 * pos.get(id)! + (c.side === 'left' ? 1 : 2))
        q.push(c.id)
      }
    }
    for (const [id, i] of pos) if (i >= p.nodes.length) out.push(`heap shape broken: ${id} sits at array index ${i} but there are ${p.nodes.length} nodes (a heap is a complete tree)`)
    for (const n of p.nodes) {
      if (!n.parent) continue
      const c = cmp(n.keys[0]!, byId.get(n.parent)!.keys[0]!)
      if (v === 'heap-min' ? c < 0 : c > 0) out.push(`heap order broken: ${n.id} (${n.keys[0]}) is ${v === 'heap-min' ? 'smaller' : 'larger'} than its parent ${n.parent} (${byId.get(n.parent)!.keys[0]})`)
    }
  }
  if (v === 'nary') for (const n of p.nodes) if (n.keys.length !== 1) out.push(`${n.id}: an n-ary tree node holds exactly one key`)
  if (v === 'trie') {
    if (root.keys.length) out.push('the trie root holds no character')
    for (const n of p.nodes) {
      if (n !== root && (n.keys.length !== 1 || String(n.keys[0]).length > 3)) out.push(`${n.id}: a trie edge node holds one short string`)
    }
    for (const [pid, ks] of kids) {
      const dup = ks.map((k) => String(k.keys[0])).filter((k, i, a) => a.indexOf(k) !== i)
      if (dup.length) out.push(`${pid}: two children for "${dup[0]}"`)
    }
  }
  if (v === 'btree') {
    const depth = (id: string): number => (byId.get(id)!.parent ? 1 + depth(byId.get(id)!.parent!) : 0)
    const leafDepths = new Set(p.nodes.filter((n) => !kids.has(n.id)).map((n) => depth(n.id)))
    if (leafDepths.size > 1) out.push('B-tree leaves are not all at the same depth')
    for (const n of p.nodes) {
      if (n.keys.length === 0) out.push(`${n.id}: a B-tree node holds at least one key`)
      for (let i = 1; i < n.keys.length; i++) if (cmp(n.keys[i - 1]!, n.keys[i]!) >= 0) out.push(`${n.id}: keys are not in ascending order`)
      const ks = kids.get(n.id) ?? []
      if (ks.length && ks.length !== n.keys.length + 1) out.push(`${n.id}: ${n.keys.length} keys need ${n.keys.length + 1} children, found ${ks.length}`)
      if (ks.length === n.keys.length + 1)
        ks.forEach((c, i) => {
          const lo = n.keys[i - 1]
          const hi = n.keys[i]
          for (const k of c.keys)
            if ((lo !== undefined && cmp(k, lo) <= 0) || (hi !== undefined && cmp(k, hi) >= 0)) out.push(`${c.id}: key ${k} is outside the range its parent ${n.id} gives it`)
        })
    }
  }
  return out
}

export const treeTemplate = defineTemplate<Props, Layout>({
  id: 'tree',
  description: 'A rooted tree drawn top-down: binary tree, binary search tree, min- or max-heap (optionally with its array below), n-ary tree, trie or B-tree. Each node lists its parent; binary children say which side they are on.',
  whenToUse: 'Use for tree data structures and their operations: BST insert and search, heap sift-up/down, tries over words, B-tree nodes and splits, general hierarchies of data. Not for recursion (use `call-tree`). At most 31 nodes.',
  propsSchema: Props,
  example: {
    label: 'min-heap',
    variant: 'heap-min',
    showArray: true,
    nodes: [
      { id: 'h0', keys: [1] },
      { id: 'h1', keys: [3], parent: 'h0', side: 'left' },
      { id: 'h2', keys: [6], parent: 'h0', side: 'right' },
      { id: 'h3', keys: [5], parent: 'h1', side: 'left' },
      { id: 'h4', keys: [9], parent: 'h1', side: 'right' },
      { id: 'h5', keys: [8], parent: 'h2', side: 'left' },
    ],
  },
  exampleEvidence: [
    { path: 'nodes', evidence: { blockId: 'b-heap-1', quote: 'every parent is smaller than or equal to its children' } },
    { path: 'nodes.0', evidence: { blockId: 'b-heap-1', quote: 'the minimum is always at the root' } },
    { path: 'showArray', evidence: { blockId: 'b-heap-2', quote: 'the heap is stored in an array in level order' } },
  ],
  evidencePaths: '`nodes` or `nodes.<i>`, `showArray`.',
  targetsDoc: '`node:<id>` for a node (a position: `swap` exchanges two nodes\' keys, as in sift-up); `edge:<childId>` for the link from a node to its parent; `cell:heap[<i>]` for the array mirror. `add` attaches a child under `parent`. `token` paths run along child ids.',
  targets: (p) => [
    ...p.nodes.map((n) => `node:${n.id}`),
    ...p.nodes.filter((n) => n.parent).map((n) => `edge:${n.id}`),
    ...(p.showArray && isHeap(p.variant) ? p.nodes.map((_, i) => `cell:heap[${i}]`) : []),
  ],
  supportedActions: [...BASE_ACTIONS, 'add', 'remove', 'swap', 'set', 'pointer', 'token'],
  checkInvariants,
  dropElement(p, path) {
    const lp = listPath(path)
    if (lp?.list === 'nodes' && !lp.rest) {
      const n = p.nodes[lp.index]
      if (n?.parent) {
        const gone = subtree(p.nodes, n.id)
        return { ...p, nodes: p.nodes.filter((m) => !gone.has(m.id)) }
      }
    }
    throw new TemplateDropError('tree', path)
  },
  layout,
  Component: TreeView,
})
