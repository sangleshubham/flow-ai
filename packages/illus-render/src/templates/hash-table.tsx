// `hash-table` template (§10): buckets with chains (separate chaining) or one entry per slot (open addressing).
import { z } from 'zod'

import type { TemplateViewProps } from '../types.ts'

import { Arrow, BASE_ACTIONS, BOTTOM, Cell, Decor, defineTemplate, duplicates, Id, Kit, listPath, PAD, T, TemplateDropError, TemplateSvg, Text, textW, TOP, Val, without } from './kit.tsx'
import type { Box } from './kit.tsx'

const Props = z.object({
  label: Text.optional(),
  buckets: z.number().int().min(1).max(12),
  strategy: z.enum(['chaining', 'open-addressing']),
  hashOf: Text.optional(),
  probe: z.enum(['linear', 'quadratic', 'double']).optional(),
  entries: z.array(z.object({ id: Id, key: Val, value: Val.optional(), hash: z.number().int().min(0), slot: z.number().int().min(0).optional() })).max(16),
})
type Props = z.infer<typeof Props>
type Entry = { id: string; key: string | number; value?: string | number | undefined; hash: number; slot?: number | undefined; path: string }
interface Layout {
  width: number
  height: number
  buckets: Box[]
  entries: Map<string, Box>
}

const H = 30
const GAP = 6
const entryText = (e: Pick<Entry, 'key' | 'value'>) => (e.value === undefined ? String(e.key) : `${e.key}: ${e.value}`)

function place(p: Props, entries: readonly Entry[]): Layout {
  const top = TOP + (p.label ? 18 : 0) + (p.hashOf ? 18 : 0)
  const idxW = 34
  const open = p.strategy === 'open-addressing'
  const ew = Math.max(56, ...entries.map((e) => textW(entryText(e), 13, true) + 18))
  const buckets = Array.from({ length: p.buckets }, (_, i) => ({ x: PAD, y: top + i * (H + GAP), w: open ? idxW + ew : idxW, h: H }))
  const boxes = new Map<string, Box>()
  const chainLen = new Array<number>(p.buckets).fill(0)
  for (const e of entries) {
    const b = open ? (e.slot ?? e.hash) : e.hash
    const row = buckets[b]
    if (!row) continue
    if (open) boxes.set(e.id, { x: PAD + idxW, y: row.y, w: ew, h: H })
    else boxes.set(e.id, { x: PAD + idxW + 30 + chainLen[b]! * (ew + 30), y: row.y, w: ew, h: H })
    chainLen[b]! += 1
  }
  const longest = Math.max(0, ...chainLen)
  const width = open ? PAD * 2 + idxW + ew + 60 : PAD * 2 + idxW + longest * (ew + 30) + 40
  return { width: Math.max(width, PAD * 2 + textW(p.hashOf ?? '', 11) + 10), height: top + p.buckets * (H + GAP) + BOTTOM, buckets, entries: boxes }
}

const entriesOf = (p: Props): Entry[] => p.entries.map((e, i) => ({ ...e, path: `entries.${i}` }))
const layout = (p: Props) => place(p, entriesOf(p))

function HashTableView({ ir, props: p, layout: base, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const kit = new Kit(ir, frame)
  const entries = entriesOf(p)
  const open = p.strategy === 'open-addressing'
  // `add` puts a key into the bucket named by `parent` (its index); open addressing takes the next free slot.
  for (const a of kit.added()) {
    const hash = Number(a.parent ?? 0)
    if (!(hash >= 0 && hash < p.buckets)) continue
    let slot = hash
    if (open) {
      const used = new Set(entries.map((e) => e.slot ?? e.hash))
      for (let k = 0; k < p.buckets && used.has(slot); k++) slot = (hash + k + 1) % p.buckets
    }
    entries.push({ id: a.id, key: a.label, hash, slot, path: `added.${a.id}` })
  }
  const L = kit.added().length ? place(p, entries) : base
  const top = L.buckets[0]!.y
  return (
    <TemplateSvg width={L.width} height={L.height} label={p.label ?? 'hash table'} onReady={onReady}>
      {p.label && (
        <T x={PAD} y={TOP - 4} cls="t-cap" anchor="start">
          {p.label}
        </T>
      )}
      {p.hashOf && (
        <g {...kit.ev('hashOf')}>
          <T x={PAD} y={top - 12} cls="t-cap t-mono" anchor="start">
            {p.hashOf}
          </T>
        </g>
      )}
      {L.buckets.map((b, i) => {
        const t = `cell:buckets[${i}]`
        kit.at(t, b)
        const idxBox = { ...b, w: 34 }
        return (
          <g key={t} {...kit.el(`buckets.${i}`, t)}>
            {open && <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={0} className="t-cell" />}
            <Cell box={idxBox} text={i} cls={open ? 't-band' : 't-cell'} rx={0} />
          </g>
        )
      })}
      {entries.map((e) => {
        const box = L.entries.get(e.id)
        if (!box) return null
        const t = `item:${e.id}`
        kit.at(t, box)
        const chained = !open
        const prev = chained ? entries.filter((x) => x.hash === e.hash && L.entries.get(x.id)!.x < box.x).pop() : undefined
        const from = prev ? L.entries.get(prev.id)! : L.buckets[e.hash]!
        const value = kit.val(t, '')
        return (
          <g key={e.id} {...kit.el(e.path, t)}>
            {chained && <Arrow pts={[[from.x + (prev ? from.w : 34) - (prev ? 0 : 17), from.y + H / 2], [box.x, box.y + H / 2]]} />}
            <Cell box={box} text={value !== '' ? `${e.key}: ${value}` : entryText(e)} rx={chained ? 6 : 0} cls={chained ? 't-cell' : 't-region'} sub={open && (e.slot ?? e.hash) !== e.hash ? `home ${e.hash}` : undefined} />
          </g>
        )
      })}
      <Decor kit={kit} />
    </TemplateSvg>
  )
}

function checkInvariants(p: Props): string[] {
  const out: string[] = []
  for (const d of duplicates(p.entries.map((e) => e.id))) out.push(`entry id ${d} is used twice`)
  for (const d of duplicates(p.entries.map((e) => e.key))) out.push(`key ${d} is stored twice`)
  for (const e of p.entries) if (e.hash >= p.buckets) out.push(`${e.id}: hash ${e.hash} is outside 0..${p.buckets - 1}`)
  if (p.strategy === 'chaining') {
    for (const e of p.entries) if (e.slot !== undefined && e.slot !== e.hash) out.push(`${e.id}: with chaining an entry stays in its hash bucket`)
    if (p.probe) out.push('probe is only for open addressing')
    return out
  }
  if (p.entries.length > p.buckets) out.push(`${p.entries.length} entries exceed ${p.buckets} slots`)
  const slots = p.entries.map((e) => e.slot ?? e.hash)
  for (const e of p.entries) if ((e.slot ?? e.hash) >= p.buckets) out.push(`${e.id}: slot ${e.slot} is outside 0..${p.buckets - 1}`)
  for (const d of duplicates(slots)) out.push(`slot ${d} holds two entries`)
  if (p.probe === 'linear') {
    // Linear probing: every slot between the home bucket and the actual slot is occupied.
    const used = new Set(slots)
    for (const e of p.entries) {
      const end = e.slot ?? e.hash
      for (let s = e.hash; s !== end && e.hash < p.buckets && end < p.buckets; s = (s + 1) % p.buckets)
        if (!used.has(s)) {
          out.push(`${e.id}: linear probing from ${e.hash} would stop at empty slot ${s}, not ${end}`)
          break
        }
    }
  }
  return out
}

export const hashTableTemplate = defineTemplate<Props, Layout>({
  id: 'hash-table',
  description: 'A hash table: numbered buckets with entries. With chaining each bucket holds a chain of entries; with open addressing each slot holds one entry, and `slot` records where a collision moved it. `hash` is the bucket the hash function gives.',
  whenToUse: 'Use for hash maps and sets, collisions, separate chaining, linear or quadratic probing, load factor. At most 12 buckets and 16 entries. Put the hash function, when the text gives one, in `hashOf`.',
  propsSchema: Props,
  example: {
    label: 'phone book',
    buckets: 7,
    strategy: 'chaining',
    hashOf: 'h(k) = k mod 7',
    entries: [
      { id: 'e15', key: 15, hash: 1 },
      { id: 'e22', key: 22, hash: 1 },
      { id: 'e10', key: 10, hash: 3 },
      { id: 'e6', key: 6, hash: 6 },
    ],
  },
  exampleEvidence: [
    { path: 'hashOf', evidence: { blockId: 'b-hash-1', quote: 'the hash function takes the key modulo seven' } },
    { path: 'entries.1', evidence: { blockId: 'b-hash-2', quote: '22 collides with 15 and is appended to the chain' } },
    { path: 'entries', evidence: { blockId: 'b-hash-2', quote: 'each bucket keeps a linked chain of entries' } },
  ],
  evidencePaths: '`entries` or `entries.<i>`, `buckets`, `hashOf`.',
  targetsDoc: '`cell:buckets[<i>]` for bucket i, `item:<id>` for an entry. `add` with `parent` set to the bucket index (e.g. "3") inserts a key (its label). Resizing is drawn as a second visual.',
  targets: (p) => [...p.entries.map((e) => `item:${e.id}`), ...Array.from({ length: p.buckets }, (_, i) => `cell:buckets[${i}]`)],
  supportedActions: [...BASE_ACTIONS, 'add', 'remove', 'set', 'pointer'],
  checkInvariants,
  dropElement(p, path) {
    const lp = listPath(path)
    if (lp?.list === 'entries' && !lp.rest) return { ...p, entries: without(p.entries, lp.index) }
    if (path === 'hashOf') {
      const { hashOf, ...rest } = p
      void hashOf
      return rest
    }
    throw new TemplateDropError('hash-table', path)
  },
  layout,
  Component: HashTableView,
})
