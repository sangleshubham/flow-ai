// `queue` template (§10): a horizontal FIFO queue or deque, or a fixed-capacity ring buffer.
import { z } from 'zod'

import type { TemplateViewProps } from '../types.ts'

import { BASE_ACTIONS, BOTTOM, Cell, Decor, defineTemplate, duplicates, Id, idx, Kit, listPath, PAD, T, TemplateDropError, TemplateSvg, Text, textW, TOP, Val, without } from './kit.tsx'
import type { Box } from './kit.tsx'

const Props = z.object({
  label: Text.optional(),
  items: z.array(z.object({ id: Id, value: Val })).max(12),
  variant: z.enum(['linear', 'deque', 'ring']).optional(),
  capacity: z.number().int().min(1).max(12).optional(),
  front: z.number().int().min(0).optional(),
  rear: z.number().int().min(0).optional(),
})
type Props = z.infer<typeof Props>
interface Layout {
  width: number
  height: number
  slots: Box[]
  ring: boolean
  centre?: [number, number]
}

const W = 44
const H = 30
const CONTAINER = 'queue'
const slotT = (i: number) => `cell:slots[${i}]`

function layout(p: Props): Layout {
  const w = Math.max(W, ...p.items.map((i) => textW(i.value, 13, true) + 16))
  const top = TOP + (p.label ? 18 : 0)
  if (p.variant === 'ring') {
    const n = p.capacity ?? Math.max(p.items.length, 1)
    const r = Math.max(56, (n * (w + 10)) / (2 * Math.PI))
    const cx = PAD + r + w / 2 + 14
    const cy = top + r + H / 2 + 6
    const slots = Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n
      return { x: cx + r * Math.cos(a) - w / 2, y: cy + r * Math.sin(a) - H / 2, w, h: H }
    })
    return { width: cx * 2, height: cy + r + H / 2 + 12 + BOTTOM, slots, ring: true, centre: [cx, cy] }
  }
  const n = Math.max(p.capacity ?? 0, p.items.length, 1)
  const slots = Array.from({ length: n }, (_, i) => ({ x: PAD + 34 + i * (w + 6), y: top + 6, w, h: H }))
  return { width: PAD * 2 + 68 + n * (w + 6), height: top + H + 30 + BOTTOM, slots, ring: false }
}

function QueueView({ ir, props: p, layout: L, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const kit = new Kit(ir, frame, initialFrame(p), { front: 'front', rear: 'rear' })
  const items = kit.container(CONTAINER, p.items)
  const pathOf = (id: string) => {
    const i = p.items.findIndex((x) => x.id === id)
    return i >= 0 ? `items.${i}` : `enqueued.${id}`
  }
  const n = L.slots.length
  const extra = !L.ring && items.length > n ? layout({ ...p, items, capacity: items.length }).slots : L.slots
  const slots = L.ring ? L.slots : extra
  // Ring items start at the current `front` pointer; a linear queue starts at slot 0.
  const front = L.ring ? Math.max(0, idx(kit.pointers.front ?? slotT(p.front ?? 0))) : 0
  const slotOf = (i: number) => (front + i) % slots.length
  const width = L.ring ? L.width : Math.max(L.width, PAD * 2 + 68 + slots.length * (slots[0]!.w + 6))
  return (
    <TemplateSvg width={width} height={L.height} label={p.label ?? 'queue'} onReady={onReady}>
      {p.label && (
        <T x={PAD} y={TOP - 4} cls="t-cap" anchor="start">
          {p.label}
        </T>
      )}
      {L.ring && L.centre && <circle {...kit.ev('capacity')} cx={L.centre[0]} cy={L.centre[1]} r={Math.hypot(slots[0]!.x + slots[0]!.w / 2 - L.centre[0], slots[0]!.y + H / 2 - L.centre[1])} className="t-ghost" />}
      {slots.map((b, i) => {
        const t = slotT(i)
        kit.at(t, b)
        return L.ring ? (
          <g key={t} {...kit.el(`slots.${i}`, t)}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={3} className="t-soft" />
            <T x={b.x + b.w / 2} y={b.y + b.h + 9} cls="t-small">
              {i}
            </T>
          </g>
        ) : i >= items.length ? (
          <rect key={t} {...kit.ev('capacity')} x={b.x} y={b.y} width={b.w} height={b.h} rx={3} className="t-ghost" />
        ) : null
      })}
      {items.slice(0, slots.length).map((it, i) => {
        const t = `item:${it.id}`
        const b = kit.at(t, slots[slotOf(i)]!)
        return (
          <g key={it.id} {...kit.el(pathOf(it.id), t)}>
            <Cell box={b} text={kit.val(t, it.value)} />
          </g>
        )
      })}
      {!L.ring && items.length > 0 && (
        <>
          <T x={slots[0]!.x - 6} y={slots[0]!.y + H / 2} cls="t-cap" anchor="end">
            {p.variant === 'deque' ? '⇄ front' : '← front'}
          </T>
          <T x={slots[items.length - 1]!.x + slots[0]!.w / 2} y={slots[0]!.y + H + 12} cls="t-cap">
            {p.variant === 'deque' ? 'rear ⇄' : 'rear ←'}
          </T>
        </>
      )}
      <Decor kit={kit} />
    </TemplateSvg>
  )
}

function initialFrame(p: Props) {
  const containers = { [CONTAINER]: p.items.map(({ id, value }) => ({ id, value })) }
  if (p.variant !== 'ring' || !p.capacity) return { containers }
  const front = p.front ?? 0
  return { containers, pointers: { front: slotT(front) as `cell:${string}[${number}]`, rear: slotT(p.rear ?? (front + p.items.length) % p.capacity) as `cell:${string}[${number}]` } }
}

function checkInvariants(p: Props): string[] {
  const out = duplicates(p.items.map((i) => i.id)).map((d) => `item id ${d} is used twice`)
  if (p.capacity !== undefined && p.items.length > p.capacity) out.push(`${p.items.length} items exceed the capacity of ${p.capacity}`)
  if (p.variant === 'ring') {
    if (!p.capacity) out.push('a ring buffer needs a capacity')
    else {
      const front = p.front ?? 0
      if (front >= p.capacity) out.push(`front ${front} is outside 0..${p.capacity - 1}`)
      const rear = (front + p.items.length) % p.capacity
      if (p.rear !== undefined && p.rear !== rear) out.push(`rear must be (front + items) mod capacity = ${rear}, not ${p.rear}`)
    }
  } else if (p.front !== undefined || p.rear !== undefined) out.push('front and rear indices are only for the ring variant')
  return out
}

export const queueTemplate = defineTemplate<Props, Layout>({
  id: 'queue',
  description: 'A FIFO queue or a deque drawn left (front) to right (rear), or a ring buffer: fixed-capacity slots in a circle with front and rear indices.',
  whenToUse: 'Use for queues and buffers: BFS frontiers, task and message queues, producer/consumer buffers, circular buffers with wrap-around, deques for sliding-window maxima. Items are listed front first. At most 12 items.',
  propsSchema: Props,
  example: {
    label: 'ring buffer',
    variant: 'ring',
    capacity: 8,
    front: 6,
    rear: 2,
    items: [
      { id: 'm1', value: 'A' },
      { id: 'm2', value: 'B' },
      { id: 'm3', value: 'C' },
      { id: 'm4', value: 'D' },
    ],
  },
  exampleEvidence: [
    { path: 'capacity', evidence: { blockId: 'b-ring-1', quote: 'a fixed array of eight slots used as a circle' } },
    { path: 'items', evidence: { blockId: 'b-ring-2', quote: 'four messages are waiting in the buffer' } },
    { path: 'front', evidence: { blockId: 'b-ring-2', quote: 'the read index wraps around to the start' } },
  ],
  evidencePaths: '`items` or `items.<i>`, `capacity`, `front`, `rear`.',
  targetsDoc: '`item:<id>` for an item; ring buffers also have `cell:slots[<i>]` slots, and the `front`/`rear` pointers move between slots. `enqueue`/`dequeue` use container "queue".',
  targets: (p) => [...p.items.map((i) => `item:${i.id}`), ...(p.variant === 'ring' ? Array.from({ length: p.capacity ?? 0 }, (_, i) => slotT(i)) : [])],
  supportedActions: [...BASE_ACTIONS, 'enqueue', 'dequeue', 'pointer', 'set'],
  initialFrame,
  checkInvariants,
  dropElement(p, path) {
    const lp = listPath(path)
    if (lp?.list === 'items' && !lp.rest) {
      const { rear, ...rest } = p
      void rear
      return { ...rest, items: without(p.items, lp.index) }
    }
    throw new TemplateDropError('queue', path)
  },
  layout,
  Component: QueueView,
})
