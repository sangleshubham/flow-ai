// `memory` template (§10): call-stack frames on the left, heap objects on the right, pointers between them.
import { z } from 'zod'

import type { TemplateViewProps } from '../types.ts'

import { BASE_ACTIONS, BOTTOM, Decor, defineTemplate, duplicates, head, Id, Kit, listPath, PAD, T, TemplateDropError, TemplateSvg, Text, textW, TOP, Val, without } from './kit.tsx'
import type { Box, ContainerItem, Pt } from './kit.tsx'

const Slot = z.object({ name: z.string().min(1).max(16), value: Val.optional() })
const Props = z.object({
  frames: z.array(z.object({ id: Id, name: Text, vars: z.array(Slot).max(6) })).max(6),
  heap: z.array(z.object({ id: Id, label: Text, fields: z.array(Slot).max(6) })).max(12),
  pointers: z.array(z.object({ id: Id, from: z.string().min(3).max(66), to: Id })).max(12),
})
type Props = z.infer<typeof Props>
type Obj = { id: string; title: string; slots: { name: string; value?: string | number | undefined }[]; path: string; slotKey: 'vars' | 'fields' }
interface Layout {
  width: number
  height: number
  boxes: Map<string, Box>
  colX: [number, number]
}

const HEAD = 24
const ROW = 22
const CONTAINER = 'frames'

const framesOf = (p: Props): Obj[] => p.frames.map((f, i) => ({ id: f.id, title: f.name, slots: f.vars, path: `frames.${i}`, slotKey: 'vars' }))
const heapOf = (p: Props): Obj[] => p.heap.map((o, i) => ({ id: o.id, title: o.label, slots: o.fields, path: `heap.${i}`, slotKey: 'fields' }))
const objW = (o: Obj) => Math.max(textW(o.title, 13) + 20, ...o.slots.map((s) => textW(s.name, 12, true) + textW(s.value ?? '', 12, true) + 40), 110)
const objH = (o: Obj) => HEAD + Math.max(1, o.slots.length) * ROW

function place(frames: readonly Obj[], heap: readonly Obj[]): Layout {
  const boxes = new Map<string, Box>()
  const top = TOP + 18
  const fw = Math.max(110, ...frames.map(objW))
  // The newest frame (last) is drawn at the top of the stack column.
  let y = top
  for (const f of [...frames].reverse()) {
    boxes.set(f.id, { x: PAD, y, w: fw, h: objH(f) })
    y += objH(f) + 8
  }
  const hx = PAD + fw + 90
  const hw = Math.max(110, ...heap.map(objW))
  let hy = top
  for (const o of heap) {
    boxes.set(o.id, { x: hx, y: hy, w: hw, h: objH(o) })
    hy += objH(o) + 14
  }
  return { width: hx + hw + 40 + PAD, height: Math.max(y, hy) + BOTTOM, boxes, colX: [PAD, hx] }
}

const layout = (p: Props) => place(framesOf(p), heapOf(p))

function MemoryView({ ir, props: p, layout: base, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const kit = new Kit(ir, frame)
  // `push`/`pop` on container "frames" adds or removes stack frames (the value is the frame name).
  const stack: ContainerItem[] = kit.container(CONTAINER, p.frames.map((f) => ({ id: f.id, value: f.name })))
  const known = new Map(framesOf(p).map((f) => [f.id, f]))
  const frames = stack.map((it): Obj => known.get(it.id) ?? { id: it.id, title: String(it.value), slots: [], path: `pushed.${it.id}`, slotKey: 'vars' })
  const heap = heapOf(p)
  const L = frames.length === p.frames.length && frames.every((f, i) => f.id === p.frames[i]!.id) ? base : place(frames, heap)
  const objs = [...frames, ...heap]
  const slotBox = (owner: string, name: string): Box | null => {
    const o = objs.find((x) => x.id === owner)
    const b = L.boxes.get(owner)
    const i = o?.slots.findIndex((s) => s.name === name) ?? -1
    return o && b && i >= 0 ? { x: b.x, y: b.y + HEAD + i * ROW, w: b.w, h: ROW } : null
  }
  const pointed = new Set(p.pointers.map((x) => x.from))
  return (
    <TemplateSvg width={L.width} height={L.height} label="memory" onReady={onReady}>
      <T x={L.colX[0]} y={TOP + 4} cls="t-cap t-bold" anchor="start">
        Stack
      </T>
      <T x={L.colX[1]} y={TOP + 4} cls="t-cap t-bold" anchor="start">
        Heap
      </T>
      {objs.map((o) => {
        const b = L.boxes.get(o.id)
        if (!b) return null
        const t = `node:${o.id}`
        kit.at(t, { ...b, h: HEAD })
        return (
          <g key={o.id}>
            <g {...kit.el(o.path, t)}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} className="t-cell" />
              <rect x={b.x} y={b.y} width={b.w} height={HEAD} rx={4} className="t-band" />
              <T x={b.x + 8} y={b.y + HEAD / 2} cls="t-bold" anchor="start">
                {o.title}
              </T>
            </g>
            {o.slots.map((s, i) => {
              const st = `item:${o.id}.${s.name}`
              const sb = kit.at(st, { x: b.x, y: b.y + HEAD + i * ROW, w: b.w, h: ROW })
              const v = kit.val(st, s.value ?? (pointed.has(`${o.id}.${s.name}`) ? '•' : ''))
              return (
                <g key={s.name} {...kit.el(`${o.path}.${o.slotKey}.${i}`, st)}>
                  <rect x={sb.x + 1} y={sb.y} width={sb.w - 2} height={ROW} className="t-region" />
                  <T x={sb.x + 8} y={sb.y + ROW / 2} cls="t-mono t-cap" anchor="start">
                    {s.name}
                  </T>
                  <T x={sb.x + sb.w - 10} y={sb.y + ROW / 2} cls="t-mono" anchor="end">
                    {v}
                  </T>
                </g>
              )
            })}
          </g>
        )
      })}
      {p.pointers.map((ptr, k) => {
        const t = `edge:${ptr.id}`
        const dot = ptr.from.lastIndexOf('.')
        const src = slotBox(ptr.from.slice(0, dot), ptr.from.slice(dot + 1))
        const to = String(kit.val(t, ptr.to))
        const dst = L.boxes.get(to)
        if (!src || !dst) return null
        const a: Pt = [src.x + src.w - 4, src.y + ROW / 2]
        const right = a[0] < dst.x
        const b: Pt = right ? [dst.x, dst.y + HEAD / 2] : [dst.x + dst.w, dst.y + HEAD / 2]
        const c1: Pt = [a[0] + 50, a[1]]
        const c2: Pt = right ? [b[0] - 50, b[1]] : [b[0] + 50, b[1]]
        kit.line(ptr.id, [a, c1, c2, b])
        return (
          <g key={ptr.id} {...kit.el(`pointers.${k}`, t)}>
            <circle cx={a[0]} cy={a[1]} r={2.5} className="t-head" />
            <path d={`M${a.join(',')} C${c1.join(',')} ${c2.join(',')} ${b.join(',')}`} className="t-link" />
            <polygon points={head(c2, b)} className="t-head" />
          </g>
        )
      })}
      <Decor kit={kit} badges={objs.map((o) => `node:${o.id}`)} />
    </TemplateSvg>
  )
}

function checkInvariants(p: Props): string[] {
  const out: string[] = []
  const objs = [...framesOf(p), ...heapOf(p)]
  if (objs.length > 16) out.push(`${objs.length} frames and objects exceed the limit of 16`)
  for (const d of duplicates(objs.map((o) => o.id))) out.push(`id ${d} is used twice`)
  for (const o of objs) for (const d of duplicates(o.slots.map((s) => s.name))) out.push(`${o.id}: slot ${d} is listed twice`)
  for (const d of duplicates(p.pointers.map((x) => x.id))) out.push(`pointer id ${d} is used twice`)
  for (const d of duplicates(p.pointers.map((x) => x.from))) out.push(`${d} holds two pointers`)
  const heapIds = new Set(p.heap.map((o) => o.id))
  for (const x of p.pointers) {
    const dot = x.from.lastIndexOf('.')
    const owner = objs.find((o) => o.id === x.from.slice(0, dot))
    if (dot < 0 || !owner || !owner.slots.some((s) => s.name === x.from.slice(dot + 1))) out.push(`pointer ${x.id}: source ${x.from} is not "<frame or object id>.<variable>"`)
    if (!heapIds.has(x.to)) out.push(`pointer ${x.id}: target ${x.to} is not a heap object`)
  }
  return out
}

export const memoryTemplate = defineTemplate<Props, Layout>({
  id: 'memory',
  description: 'A memory diagram: call-stack frames with their local variables (oldest first; the last frame is the current call), heap objects with fields, and pointers from a variable or field (`"<owner id>.<name>"`) to a heap object.',
  whenToUse: 'Use for references and aliasing, stack vs heap, object graphs, pointer manipulation in C or Go, garbage collection reachability, and what a function call allocates. At most 16 frames and objects together.',
  propsSchema: Props,
  example: {
    frames: [
      { id: 'main', name: 'main()', vars: [{ name: 'list' }] },
      { id: 'push', name: 'push(l, 7)', vars: [{ name: 'l' }, { name: 'v', value: 7 }, { name: 'n' }] },
    ],
    heap: [
      { id: 'L', label: 'List', fields: [{ name: 'head' }, { name: 'size', value: 1 }] },
      { id: 'N1', label: 'Node', fields: [{ name: 'val', value: 3 }, { name: 'next', value: 'nil' }] },
      { id: 'N2', label: 'Node', fields: [{ name: 'val', value: 7 }, { name: 'next' }] },
    ],
    pointers: [
      { id: 'p1', from: 'main.list', to: 'L' },
      { id: 'p2', from: 'push.l', to: 'L' },
      { id: 'p3', from: 'L.head', to: 'N1' },
      { id: 'p4', from: 'push.n', to: 'N2' },
      { id: 'p5', from: 'N2.next', to: 'N1' },
    ],
  },
  exampleEvidence: [
    { path: 'frames.1', evidence: { blockId: 'b-mem-2', quote: 'push receives a pointer to the same list' } },
    { path: 'pointers.1', evidence: { blockId: 'b-mem-2', quote: 'l and list now refer to the same List value' } },
    { path: 'heap.2', evidence: { blockId: 'b-mem-3', quote: 'a new node is allocated on the heap' } },
  ],
  evidencePaths: '`frames.<i>`, `frames.<i>.vars.<j>`, `heap.<i>`, `heap.<i>.fields.<j>`, `pointers.<k>`.',
  targetsDoc: '`node:<frame or object id>`; `item:<owner id>.<name>` for a variable or field (`set` changes its value); `edge:<pointerId>` for a pointer (`set` it to another heap id to re-point it). `push`/`pop` on container "frames" call and return (push value = frame name).',
  targets: (p) => [
    ...[...framesOf(p), ...heapOf(p)].flatMap((o) => [`node:${o.id}`, ...o.slots.map((s) => `item:${o.id}.${s.name}`)]),
    ...p.pointers.map((x) => `edge:${x.id}`),
  ],
  supportedActions: [...BASE_ACTIONS, 'push', 'pop', 'set', 'remove', 'pointer', 'token'],
  initialFrame: (p) => ({ containers: { [CONTAINER]: p.frames.map((f) => ({ id: f.id, value: f.name })) } }),
  checkInvariants,
  dropElement(p, path) {
    const lp = listPath(path)
    if (lp?.list === 'pointers' && !lp.rest) return { ...p, pointers: without(p.pointers, lp.index) }
    if ((lp?.list === 'frames' || lp?.list === 'heap') && lp.index < p[lp.list].length) {
      const owner = p[lp.list][lp.index]!
      const slot = /^(?:vars|fields)\.(\d+)$/.exec(lp.rest)
      if (!lp.rest) {
        const keep = p.pointers.filter((x) => x.to !== owner.id && !x.from.startsWith(`${owner.id}.`))
        return lp.list === 'frames' ? { ...p, frames: without(p.frames, lp.index), pointers: keep } : { ...p, heap: without(p.heap, lp.index), pointers: keep }
      }
      if (slot) {
        const j = Number(slot[1])
        const name = ('vars' in owner ? owner.vars : owner.fields)[j]?.name
        const pointers = p.pointers.filter((x) => x.from !== `${owner.id}.${name}`)
        if (lp.list === 'frames') return { ...p, pointers, frames: p.frames.map((f, i) => (i === lp.index ? { ...f, vars: without(f.vars, j) } : f)) }
        return { ...p, pointers, heap: p.heap.map((o, i) => (i === lp.index ? { ...o, fields: without(o.fields, j) } : o)) }
      }
    }
    throw new TemplateDropError('memory', path)
  },
  layout,
  Component: MemoryView,
})
