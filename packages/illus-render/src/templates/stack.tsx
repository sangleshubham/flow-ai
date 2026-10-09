// `stack` template (§10): a vertical stack, bottom item first; the last item is the top.
import { z } from 'zod'

import type { TemplateViewProps } from '../types.ts'

import { BASE_ACTIONS, BOTTOM, Cell, Decor, defineTemplate, duplicates, Id, Kit, listPath, PAD, T, TemplateDropError, TemplateSvg, Text, textW, TOP, Val, without } from './kit.tsx'
import type { Box, ContainerItem } from './kit.tsx'

const Props = z.object({
  label: Text.optional(),
  items: z.array(z.object({ id: Id, value: Val })).max(10),
  capacity: z.number().int().min(1).max(10).optional(),
})
type Props = z.infer<typeof Props>
interface Layout {
  width: number
  height: number
  slots: Box[]
}

const H = 30
const CONTAINER = 'stack'

function place(n: number, valueW: number, hasLabel: boolean): Layout {
  const w = Math.max(80, valueW + 24)
  const top = TOP + (hasLabel ? 18 : 0)
  const slots = Array.from({ length: n }, (_, i) => ({ x: PAD + 6, y: top + (n - 1 - i) * (H + 4), w, h: H }))
  return { width: PAD * 2 + w + 12 + 50, height: top + n * (H + 4) + 8 + BOTTOM, slots }
}

const layout = (p: Props) => place(Math.max(p.capacity ?? 0, p.items.length, 1), Math.max(0, ...p.items.map((i) => textW(i.value, 13, true))), !!p.label)

function StackView({ ir, props: p, layout: base, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const kit = new Kit(ir, frame)
  const items = kit.container(CONTAINER, p.items)
  const n = Math.max(p.capacity ?? 0, items.length, 1)
  const L = n === base.slots.length ? base : place(n, Math.max(0, ...items.map((i) => textW(i.value, 13, true))), !!p.label)
  const first = L.slots[0]!
  const top = L.slots[n - 1]!
  const topBox = items.length > 0 ? L.slots[items.length - 1] : undefined
  const pathOf = (id: string) => {
    const i = p.items.findIndex((x) => x.id === id)
    return i >= 0 ? `items.${i}` : `pushed.${id}`
  }
  return (
    <TemplateSvg width={L.width} height={L.height} label={p.label ?? 'stack'} onReady={onReady}>
      {p.label && (
        <T x={PAD} y={TOP - 4} cls="t-cap" anchor="start">
          {p.label}
        </T>
      )}
      <path d={`M${PAD},${top.y - 4} V${first.y + H + 4} H${PAD + first.w + 12} V${top.y - 4}`} className="t-link" />
      {L.slots.slice(items.length).map((b, i) => (
        <rect key={`ghost-${i}`} {...kit.ev('capacity')} x={b.x} y={b.y} width={b.w} height={b.h} rx={3} className="t-ghost" />
      ))}
      {items.map((it: ContainerItem, i) => {
        const t = `item:${it.id}`
        const b = kit.at(t, L.slots[i]!)
        return (
          <g key={it.id} {...kit.el(pathOf(it.id), t)}>
            <Cell box={b} text={kit.val(t, it.value)} />
          </g>
        )
      })}
      {/* The top marker tracks the current contents, so it follows push/pop frames. */}
      {topBox && (
        <g data-top={items[items.length - 1]!.id}>
          <rect x={topBox.x - 3} y={topBox.y - 3} width={topBox.w + 6} height={topBox.h + 6} rx={5} className="t-top" />
          <T x={topBox.x + topBox.w + 14} y={topBox.y + H / 2} cls="t-ptr" anchor="start">
            ◂ top
          </T>
        </g>
      )}
      <Decor kit={kit} />
    </TemplateSvg>
  )
}

function checkInvariants(p: Props): string[] {
  const out = duplicates(p.items.map((i) => i.id)).map((d) => `item id ${d} is used twice`)
  if (p.capacity !== undefined && p.items.length > p.capacity) out.push(`${p.items.length} items exceed the capacity of ${p.capacity}`)
  return out
}

export const stackTemplate = defineTemplate<Props, Layout>({
  id: 'stack',
  description: 'A LIFO stack drawn vertically. Items are listed bottom first; the last item is the top. An optional capacity draws the empty slots.',
  whenToUse: 'Use for stacks and LIFO behaviour: push and pop sequences, bracket matching, undo history, DFS with an explicit stack, expression evaluation. At most 10 items. For call stacks with local variables use `memory`.',
  propsSchema: Props,
  example: {
    label: 'bracket stack',
    items: [
      { id: 'b1', value: '(' },
      { id: 'b2', value: '[' },
      { id: 'b3', value: '{' },
    ],
    capacity: 6,
  },
  exampleEvidence: [
    { path: 'items', evidence: { blockId: 'b-brackets-2', quote: 'push every opening bracket onto the stack' } },
    { path: 'items.2', evidence: { blockId: 'b-brackets-3', quote: 'the most recent opening bracket is on top' } },
  ],
  evidencePaths: '`items` or `items.<i>`, `capacity`.',
  targetsDoc: '`item:<id>` for an item. `push`/`pop` use container "stack"; a pushed item becomes `item:<its id>`.',
  targets: (p) => p.items.map((i) => `item:${i.id}`),
  supportedActions: [...BASE_ACTIONS, 'push', 'pop', 'set', 'pointer'],
  initialFrame: (p) => ({ containers: { [CONTAINER]: p.items.map(({ id, value }) => ({ id, value })) } }),
  checkInvariants,
  dropElement(p, path) {
    const lp = listPath(path)
    if (lp?.list === 'items' && !lp.rest) return { ...p, items: without(p.items, lp.index) }
    throw new TemplateDropError('stack', path)
  },
  layout,
  Component: StackView,
})
