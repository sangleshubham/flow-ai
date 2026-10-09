// `cache` template (§10): the key map above, the eviction order (recency or frequency list) below.
import { z } from 'zod'

import type { TemplateViewProps } from '../types.ts'

import { Arrow, BASE_ACTIONS, BOTTOM, Cell, Decor, defineTemplate, duplicates, Id, Kit, listPath, PAD, T, TemplateDropError, TemplateSvg, textW, TOP, Val, without } from './kit.tsx'
import type { Box, ContainerItem } from './kit.tsx'

const Props = z.object({
  policy: z.enum(['lru', 'lfu', 'fifo']),
  capacity: z.number().int().min(1).max(8),
  entries: z.array(z.object({ id: Id, key: Val, value: Val.optional(), freq: z.number().int().min(0).optional() })).max(8),
})
type Props = z.infer<typeof Props>
type Entry = { id: string; key: string | number; value?: string | number | undefined; freq?: number | undefined; path: string }
interface Layout {
  width: number
  height: number
  slots: Box[]
  listY: number
  cellW: number
}

const H = 30
const CONTAINER = 'order'
const GAP = 26
const text = (e: Pick<Entry, 'key' | 'value'>) => (e.value === undefined ? String(e.key) : `${e.key}: ${e.value}`)

function layout(p: Props): Layout {
  const cellW = Math.max(56, ...p.entries.map((e) => textW(text(e), 13, true) + 18))
  const top = TOP + 18
  const slots = Array.from({ length: p.capacity }, (_, i) => ({ x: PAD + i * (cellW + 6), y: top, w: cellW, h: H }))
  const listY = top + H + 48
  const width = Math.max(PAD * 2 + p.capacity * (cellW + 6), PAD * 2 + 40 + p.capacity * (cellW + GAP) + 40)
  return { width, height: listY + H + 20 + BOTTOM, slots, listY, cellW }
}

const ENDS = { lru: ['LRU', 'MRU'], lfu: ['least used', 'most used'], fifo: ['oldest', 'newest'] } as const

function CacheView({ ir, props: p, layout: L, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const kit = new Kit(ir, frame)
  const entries: Entry[] = p.entries.map((e, i) => ({ ...e, path: `entries.${i}` }))
  for (const a of kit.added()) if (!entries.some((e) => e.id === a.id)) entries.push({ id: a.id, key: a.label, path: `added.${a.id}` })
  const removed = new Set(frame?.removed ?? [])
  const order: ContainerItem[] = kit.container(CONTAINER, p.entries.map((e) => ({ id: e.id, value: e.key })))
  const byId = new Map(entries.map((e) => [e.id, e]))
  const [lo, hi] = ENDS[p.policy]
  const listX = PAD + 46
  return (
    <TemplateSvg width={L.width} height={L.height} label={`${p.policy.toUpperCase()} cache`} onReady={onReady}>
      <g {...kit.ev('capacity')}>
        <T x={PAD} y={TOP + 2} cls="t-cap t-bold" anchor="start">
          {`map (capacity ${p.capacity})`}
        </T>
      </g>
      {L.slots.map((b, i) => {
        const e = entries[i]
        if (!e) return <rect key={`s${i}`} x={b.x} y={b.y} width={b.w} height={b.h} rx={3} className="t-ghost" />
        const t = `item:${e.id}`
        kit.at(t, b)
        const v = kit.frame?.values[t]
        return (
          <g key={e.id} {...kit.el(e.path, t)}>
            <Cell box={b} text={v !== undefined ? `${e.key}: ${v}` : text(e)} rx={3} />
          </g>
        )
      })}
      <g {...kit.ev('policy')}>
        <T x={PAD} y={L.listY - 16} cls="t-cap t-bold" anchor="start">
          {p.policy === 'lfu' ? 'eviction order (by use count)' : p.policy === 'lru' ? 'recency list' : 'insertion order'}
        </T>
        <T x={PAD} y={L.listY + H / 2} cls="t-small" anchor="start">
          {lo}
        </T>
      </g>
      {order.map((it, i) => {
        const e = byId.get(it.id)
        const t = `node:${it.id}`
        const b = kit.at(t, { x: listX + i * (L.cellW + GAP), y: L.listY, w: L.cellW, h: H })
        const freq = kit.val(t, e?.freq ?? '')
        return (
          <g key={it.id} {...kit.el(e?.path ?? `order.${it.id}`, t, removed.has(`item:${it.id}`) ? 'illus-removed' : '')}>
            {i > 0 && (
              <Arrow
                pts={[
                  [b.x - GAP + 2, b.y + H / 2],
                  [b.x - 2, b.y + H / 2],
                ]}
              />
            )}
            <Cell box={b} text={e?.key ?? it.value} rx={H / 2} sub={freq !== '' ? `used ${freq}×` : undefined} />
          </g>
        )
      })}
      {order.length > 0 && (
        <T x={listX + order.length * (L.cellW + GAP) - GAP + 6} y={L.listY + H / 2} cls="t-small" anchor="start">
          {hi}
        </T>
      )}
      <Decor kit={kit} />
    </TemplateSvg>
  )
}

function checkInvariants(p: Props): string[] {
  const out: string[] = []
  if (p.entries.length > p.capacity) out.push(`${p.entries.length} entries exceed the capacity of ${p.capacity}`)
  for (const d of duplicates(p.entries.map((e) => e.id))) out.push(`entry id ${d} is used twice`)
  for (const d of duplicates(p.entries.map((e) => e.key))) out.push(`key ${d} is cached twice`)
  if (p.policy === 'lfu') {
    for (const e of p.entries) if (e.freq === undefined) out.push(`${e.id}: an LFU cache needs a use count (freq) for every entry`)
    for (let i = 1; i < p.entries.length; i++) {
      const a = p.entries[i - 1]!.freq
      const b = p.entries[i]!.freq
      if (a !== undefined && b !== undefined && a > b) out.push(`LFU entries are listed least used first; ${p.entries[i]!.id} (${b}) comes after ${p.entries[i - 1]!.id} (${a})`)
    }
  }
  return out
}

export const cacheTemplate = defineTemplate<Props, Layout>({
  id: 'cache',
  description: 'A bounded cache: the key→value map (capacity slots) above, and below it the order the policy evicts in, listed first-to-evict first (LRU: least recently used first; LFU: least used first, with use counts; FIFO: oldest first).',
  whenToUse: 'Use for cache eviction policies (LRU, LFU, FIFO), buffer pools and page replacement, and get/put walkthroughs. At most 8 slots.',
  propsSchema: Props,
  example: {
    policy: 'lru',
    capacity: 4,
    entries: [
      { id: 'kB', key: 'B', value: 2 },
      { id: 'kD', key: 'D', value: 4 },
      { id: 'kA', key: 'A', value: 1 },
    ],
  },
  exampleEvidence: [
    { path: 'policy', evidence: { blockId: 'b-lru-1', quote: 'evicts the least recently used entry when the cache is full' } },
    { path: 'entries.2', evidence: { blockId: 'b-lru-2', quote: 'reading A moves it to the most recently used end' } },
    { path: 'capacity', evidence: { blockId: 'b-lru-1', quote: 'a cache that holds four pages' } },
  ],
  evidencePaths: '`entries` or `entries.<i>`, `capacity`, `policy`.',
  targetsDoc: '`item:<entryId>` for a map slot (`set` changes its value); `node:<entryId>` for its place in the eviction order (`set` shows a use count). Container "order" is the eviction order: a get or put is `enqueue` of the entry (it moves to the most-recent end), an eviction is `dequeue`; a new key is `add` then `enqueue`.',
  targets: (p) => [...p.entries.map((e) => `item:${e.id}`), ...p.entries.map((e) => `node:${e.id}`)],
  supportedActions: [...BASE_ACTIONS, 'enqueue', 'dequeue', 'add', 'remove', 'set', 'pointer'],
  initialFrame: (p) => ({ containers: { [CONTAINER]: p.entries.map((e) => ({ id: e.id, value: e.key })) } }),
  checkInvariants,
  dropElement(p, path) {
    const lp = listPath(path)
    if (lp?.list === 'entries' && !lp.rest) return { ...p, entries: without(p.entries, lp.index) }
    throw new TemplateDropError('cache', path)
  },
  layout,
  Component: CacheView,
})
