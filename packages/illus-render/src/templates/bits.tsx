// `bits` template (§10): bit fields of a word, packet header or record, in rows of `wordSize` bits.
import { z } from 'zod'

import type { TemplateViewProps } from '../types.ts'

import { BASE_ACTIONS, BOTTOM, Decor, defineTemplate, duplicates, Id, Kit, PAD, T, TemplateDropError, TemplateSvg, Text, TOP, Val } from './kit.tsx'
import type { Box } from './kit.tsx'

const Props = z.object({
  label: Text.optional(),
  wordSize: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]),
  fields: z.array(z.object({ id: Id, label: Text, bits: z.number().int().min(1).max(64), value: Val.optional() })).min(1).max(16),
})
type Props = z.infer<typeof Props>
interface Seg extends Box {
  field: number
  first: boolean
}
interface Layout {
  width: number
  height: number
  bitW: number
  rows: number
  segs: Seg[]
  y0: number
}

const ROW_H = 40
const ROW_W = 512

function layout(p: Props): Layout {
  const bitW = ROW_W / p.wordSize
  const y0 = TOP + (p.label ? 18 : 0) + 14
  const segs: Seg[] = []
  let at = 0
  p.fields.forEach((f, i) => {
    let left = f.bits
    let first = true
    while (left > 0) {
      const row = Math.floor(at / p.wordSize)
      const col = at % p.wordSize
      const n = Math.min(left, p.wordSize - col)
      segs.push({ x: PAD + col * bitW, y: y0 + row * ROW_H, w: n * bitW, h: ROW_H, field: i, first })
      first = false
      at += n
      left -= n
    }
  })
  const rows = Math.max(1, Math.ceil(at / p.wordSize))
  return { width: PAD * 2 + ROW_W, height: y0 + rows * ROW_H + BOTTOM, bitW, rows, segs, y0 }
}

/** Fits text into `w` px, cutting with an ellipsis. */
const fit = (s: string, w: number, px: number) => {
  const max = Math.floor(w / (px * 0.6))
  return s.length <= max ? s : max <= 1 ? '' : `${s.slice(0, max - 1)}…`
}

function BitsView({ ir, props: p, layout: L, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const kit = new Kit(ir, frame)
  const tickEvery = p.wordSize === 64 ? 8 : p.wordSize === 32 ? 4 : 1
  return (
    <TemplateSvg width={L.width} height={L.height} label={p.label ?? 'bit fields'} onReady={onReady}>
      {p.label && (
        <T x={PAD} y={TOP - 4} cls="t-cap" anchor="start">
          {p.label}
        </T>
      )}
      {Array.from({ length: p.wordSize / tickEvery }, (_, k) => (
        <T key={k} x={PAD + k * tickEvery * L.bitW + (tickEvery === 1 ? L.bitW / 2 : 2)} y={L.y0 - 8} cls="t-small" anchor={tickEvery === 1 ? 'middle' : 'start'}>
          {k * tickEvery}
        </T>
      ))}
      {p.fields.map((f, i) => {
        const t = `item:${f.id}`
        const segs = L.segs.filter((s) => s.field === i)
        const main = segs.reduce((a, b) => (b.w > a.w ? b : a), segs[0]!)
        kit.at(t, main)
        const v = kit.val(t, f.value ?? '')
        return (
          <g key={f.id} {...kit.el(`fields.${i}`, t)}>
            {segs.map((s, k) => (
              <rect key={k} x={s.x} y={s.y} width={s.w} height={s.h} className="t-cell" />
            ))}
            <T x={main.x + main.w / 2} y={main.y + (v !== '' ? 13 : ROW_H / 2)} cls="t-cap">
              {fit(f.label, main.w - 4, 11)}
            </T>
            {v !== '' && (
              <T x={main.x + main.w / 2} y={main.y + 28} cls="t-mono">
                {fit(String(v), main.w - 4, 13)}
              </T>
            )}
            {main.w >= 40 && (
              <T x={main.x + main.w - 3} y={main.y + ROW_H - 6} cls="t-small" anchor="end">
                {f.bits}
              </T>
            )}
          </g>
        )
      })}
      <Decor kit={kit} />
    </TemplateSvg>
  )
}

/** Width in bits a value needs, or null for free text. `0b…` binary, `0x…` hex, numbers decimal. */
function valueBits(v: string | number): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? Math.max(1, Math.ceil(Math.log2(v + 1))) : NaN
  if (/^0b[01]+$/i.test(v)) return v.length - 2
  if (/^0x[0-9a-f]+$/i.test(v)) {
    const n = Number.parseInt(v.slice(2), 16)
    return Math.max(1, Math.ceil(Math.log2(n + 1)))
  }
  return null
}

function checkInvariants(p: Props): string[] {
  const out = duplicates(p.fields.map((f) => f.id)).map((d) => `field id ${d} is used twice`)
  const total = p.fields.reduce((a, f) => a + f.bits, 0)
  if (total > 512) out.push(`${total} bits exceed the limit of 512`)
  for (const f of p.fields) {
    if (f.value === undefined) continue
    const need = valueBits(f.value)
    if (Number.isNaN(need)) out.push(`${f.id}: value ${f.value} is not a non-negative integer`)
    else if (need !== null && need > f.bits) out.push(`${f.id}: value ${f.value} needs ${need} bits but the field has ${f.bits}`)
  }
  return out
}

export const bitsTemplate = defineTemplate<Props, Layout>({
  id: 'bits',
  description: 'Bit fields laid out in rows of `wordSize` bits (bit 0 at the left): fields in order with their widths, optional values (decimal numbers, 0b… binary, 0x… hex, or short text).',
  whenToUse: 'Use for packet and protocol headers (TCP, IPv4), instruction encodings, flag words, float layouts (sign, exponent, mantissa), bit masks. Fields are listed in wire order. At most 16 fields and 512 bits.',
  propsSchema: Props,
  example: {
    label: 'IEEE 754 single precision',
    wordSize: 32,
    fields: [
      { id: 'sign', label: 'sign', bits: 1, value: 0 },
      { id: 'exp', label: 'exponent', bits: 8, value: '0b10000001' },
      { id: 'frac', label: 'fraction', bits: 23, value: '0x200000' },
    ],
  },
  exampleEvidence: [
    { path: 'fields.0', evidence: { blockId: 'b-float-1', quote: 'one sign bit, which is 0 for positive numbers' } },
    { path: 'fields.1', evidence: { blockId: 'b-float-1', quote: 'an 8-bit exponent stored with a bias of 127' } },
    { path: 'fields.2', evidence: { blockId: 'b-float-1', quote: 'a 23-bit fraction' } },
  ],
  evidencePaths: '`fields` or `fields.<i>`, `wordSize`.',
  targetsDoc: '`item:<fieldId>` for a field (`set` writes its value).',
  targets: (p) => p.fields.map((f) => `item:${f.id}`),
  supportedActions: [...BASE_ACTIONS, 'set', 'pointer'],
  checkInvariants,
  dropElement(_p, path) {
    // Removing a field would shift every later field's bit offsets.
    throw new TemplateDropError('bits', path)
  },
  layout,
  Component: BitsView,
})
