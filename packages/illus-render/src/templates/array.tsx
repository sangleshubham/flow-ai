// `array` template (§10): cells with indices, or bars for sorting; named index pointers and ranges.
import { z } from 'zod'

import type { TemplateViewProps } from '../types.ts'

import { BASE_ACTIONS, BOTTOM, Cell, Decor, defineTemplate, duplicates, Id, idx, Kit, listPath, PAD, PtrName, ptrPaths, T, TemplateDropError, TemplateSvg, Text, textW, TOP, Val, without } from './kit.tsx'
import type { Box } from './kit.tsx'

const Props = z.object({
  label: Text.optional(),
  values: z.array(Val).min(1).max(16),
  variant: z.enum(['cells', 'bars']).optional(),
  pointers: z.array(z.object({ name: PtrName, index: z.number().int() })).max(6).optional(),
  ranges: z.array(z.object({ id: Id, from: z.number().int(), to: z.number().int(), label: Text.optional() })).max(4).optional(),
})
type Props = z.infer<typeof Props>

interface Layout {
  width: number
  height: number
  cells: Box[]
  baseY: number
  ranges: { id: string; x1: number; x2: number; y: number }[]
}

const H = 36
const BAR_MAX = 110

const cellT = (i: number) => `cell:values[${i}]`
const num = (v: string | number) => (typeof v === 'number' ? v : Number(v))

function layout(p: Props): Layout {
  const bars = p.variant === 'bars'
  const w = Math.max(34, ...p.values.map((v) => textW(v, 13, true) + 16))
  const top = TOP + (p.label ? 18 : 0)
  const max = Math.max(1, ...p.values.map((v) => Math.abs(num(v)) || 0))
  const cells = p.values.map((v, i) => {
    const h = bars ? 14 + (BAR_MAX * (Math.abs(num(v)) || 0)) / max : H
    const base = top + (bars ? BAR_MAX + 14 : H)
    return { x: PAD + i * (w + (bars ? 6 : 0)), y: base - h, w, h }
  })
  const baseY = top + (bars ? BAR_MAX + 14 : H)
  const ranges = (p.ranges ?? []).map((r, k) => ({
    id: r.id,
    x1: cells[Math.max(0, r.from)]?.x ?? PAD,
    x2: (cells[Math.min(p.values.length - 1, r.to)] ?? cells[cells.length - 1]!).x + w,
    y: baseY + 26 + k * 20,
  }))
  const last = cells[cells.length - 1]!
  return { width: last.x + w + PAD * 2, height: baseY + 18 + ranges.length * 20 + BOTTOM, cells, baseY, ranges }
}

function ArrayView({ ir, props: p, layout: L, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const kit = new Kit(ir, frame, initialFrame(p), ptrPaths(p.pointers))
  const bars = p.variant === 'bars'
  const max = Math.max(1, ...p.values.map((v) => Math.abs(num(v)) || 0))
  // Bars follow `set` values, so their height is recomputed from the current content.
  const cells = L.cells.map((b, i) => {
    if (!bars) return b
    const v = Math.abs(num(kit.content(cellT(i), (el) => p.values[idx(el)]!))) || 0
    const h = 14 + (BAR_MAX * Math.min(v, max)) / max
    return { ...b, y: L.baseY - h, h }
  })
  return (
    <TemplateSvg width={L.width} height={L.height} label={p.label ?? 'array'} onReady={onReady}>
      {p.label && (
        <T x={PAD} y={TOP - 4} cls="t-cap" anchor="start">
          {p.label}
        </T>
      )}
      {cells.map((b, i) => {
        const t = cellT(i)
        const v = kit.content(t, (el) => p.values[idx(el)]!)
        kit.at(t, { ...b, h: L.baseY + 16 - b.y })
        return (
          <g key={i} {...kit.el(`values.${i}`, t)}>
            {bars ? (
              <>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={2} className="t-bar" />
                <T x={b.x + b.w / 2} y={b.y + 9} cls="t-mono t-small">
                  {v}
                </T>
              </>
            ) : (
              <Cell box={b} text={v} rx={0} />
            )}
            <T x={b.x + b.w / 2} y={L.baseY + 10} cls="t-small">
              {i}
            </T>
          </g>
        )
      })}
      {L.ranges.map((r, k) => {
        const range = p.ranges![k]!
        const t = `item:${r.id}`
        kit.at(t, { x: r.x1, y: r.y - 6, w: r.x2 - r.x1, h: 12 })
        return (
          <g key={r.id} {...kit.el(`ranges.${k}`, t)}>
            <path d={`M${r.x1 + 2},${r.y - 6} V${r.y} H${r.x2 - 2} V${r.y - 6}`} className="t-link" />
            <T x={(r.x1 + r.x2) / 2} y={r.y + 8} cls="t-cap">
              {range.label ?? `${range.from}..${range.to}`}
            </T>
          </g>
        )
      })}
      <Decor kit={kit} />
    </TemplateSvg>
  )
}

function initialFrame(p: Props) {
  return { pointers: Object.fromEntries((p.pointers ?? []).filter((x) => x.index >= 0 && x.index < p.values.length).map((x) => [x.name, cellT(x.index) as `cell:${string}[${number}]`])) }
}

function checkInvariants(p: Props): string[] {
  const out: string[] = []
  const n = p.values.length
  for (const ptr of p.pointers ?? [])
    if (ptr.index < -1 || ptr.index > n) out.push(`pointer ${ptr.name} = ${ptr.index} is outside -1..${n}`)
  for (const d of duplicates((p.pointers ?? []).map((x) => x.name))) out.push(`pointer ${d} is listed twice`)
  for (const d of duplicates((p.ranges ?? []).map((r) => r.id))) out.push(`range id ${d} is used twice`)
  for (const r of p.ranges ?? []) {
    if (r.from > r.to) out.push(`range ${r.id} starts after it ends (${r.from} > ${r.to})`)
    if (r.from < 0 || r.to >= n) out.push(`range ${r.id} (${r.from}..${r.to}) is outside 0..${n - 1}`)
  }
  if (p.variant === 'bars')
    p.values.forEach((v, i) => {
      if (Number.isNaN(num(v))) out.push(`bars need numbers; values.${i} is "${v}"`)
    })
  return out
}

export const arrayTemplate = defineTemplate<Props, Layout>({
  id: 'array',
  description: 'A one-dimensional array drawn as indexed cells (or bars, for sorting), with named index pointers such as i, lo, hi and labelled index ranges.',
  whenToUse: 'Use for arrays, lists indexed by position, slices and windows: binary search, two pointers, sliding windows, partitioning, sorting passes. Use `bars` when relative sizes matter (sorting). At most 16 values.',
  propsSchema: Props,
  example: {
    label: 'sorted keys',
    values: [2, 5, 8, 12, 16, 23, 38, 56],
    pointers: [
      { name: 'lo', index: 0 },
      { name: 'mid', index: 3 },
      { name: 'hi', index: 7 },
    ],
    ranges: [{ id: 'search', from: 0, to: 7, label: 'search space' }],
  },
  exampleEvidence: [
    { path: 'values', evidence: { blockId: 'b-search-2', quote: 'Binary search works on a sorted array of keys' } },
    { path: 'pointers.1', evidence: { blockId: 'b-search-3', quote: 'compare the target with the middle element' } },
    { path: 'ranges.0', evidence: { blockId: 'b-search-3', quote: 'halving the search space at every step' } },
  ],
  evidencePaths: '`values` or `values.<i>`, `pointers.<k>`, `ranges.<k>`.',
  targetsDoc: '`cell:values[<i>]` for cell i (a position; `swap` exchanges two cells\' contents); pointers move between `cell:values[<i>]` targets; `item:<rangeId>` for a range.',
  targets: (p) => [...p.values.map((_, i) => cellT(i)), ...(p.ranges ?? []).map((r) => `item:${r.id}`)],
  supportedActions: [...BASE_ACTIONS, 'set', 'swap', 'pointer'],
  initialFrame,
  checkInvariants,
  dropElement(p, path) {
    const lp = listPath(path)
    if (lp?.list === 'pointers' && !lp.rest && p.pointers) return { ...p, pointers: without(p.pointers, lp.index) }
    if (lp?.list === 'ranges' && !lp.rest && p.ranges) return { ...p, ranges: without(p.ranges, lp.index) }
    // Removing a value would shift every index, pointer and range after it.
    throw new TemplateDropError('array', path)
  },
  layout,
  Component: ArrayView,
})
