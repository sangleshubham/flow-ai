// `layers` template (§10): a layered stack (OSI, architecture tiers) with crossings between layers.
import { z } from 'zod'

import type { TemplateViewProps } from '../types.ts'

import { Arrow, BASE_ACTIONS, BOTTOM, Decor, defineTemplate, duplicates, Id, Kit, listPath, PAD, T, TemplateDropError, TemplateSvg, Text, textW, TOP, without } from './kit.tsx'
import type { Box, Pt } from './kit.tsx'

const Props = z.object({
  label: Text.optional(),
  layers: z.array(z.object({ id: Id, label: Text, sublabel: Text.optional() })).min(2).max(8),
  crossings: z.array(z.object({ id: Id, from: Id, to: Id, label: z.string().min(1).max(16).optional() })).max(8),
})
type Props = z.infer<typeof Props>
interface Layout {
  width: number
  height: number
  bands: Box[]
  cols: number[]
}

const BAND_H = 40
const GAP = 22

function layout(p: Props): Layout {
  const top = TOP + (p.label ? 18 : 0)
  const labelW = Math.max(160, ...p.layers.map((l) => Math.max(textW(l.label, 13), textW(l.sublabel ?? '', 11)) + 24))
  const cols: number[] = []
  let x = PAD + labelW + 10
  for (const c of p.crossings) {
    const w = Math.max(34, textW(c.label ?? '', 10) + 18)
    cols.push(x + 8)
    x += w
  }
  const w = x - PAD + 10
  const bands = p.layers.map((_, i) => ({ x: PAD, y: top + i * (BAND_H + GAP), w, h: BAND_H }))
  return { width: w + PAD * 2, height: top + p.layers.length * (BAND_H + GAP) - GAP + BOTTOM, bands, cols }
}

function LayersView({ ir, props: p, layout: L, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const kit = new Kit(ir, frame)
  const index = new Map(p.layers.map((l, i) => [l.id, i]))
  return (
    <TemplateSvg width={L.width} height={L.height} label={p.label ?? 'layers'} onReady={onReady}>
      {p.label && (
        <T x={PAD} y={TOP - 4} cls="t-cap" anchor="start">
          {p.label}
        </T>
      )}
      {p.layers.map((l, i) => {
        const t = `node:${l.id}`
        const b = kit.at(t, L.bands[i]!)
        return (
          <g key={l.id} {...kit.el(`layers.${i}`, t)}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} className="t-band" />
            <T x={b.x + 12} y={b.y + (l.sublabel ? 13 : BAND_H / 2)} cls="t-bold" anchor="start">
              {l.label}
            </T>
            {l.sublabel && (
              <T x={b.x + 12} y={b.y + 29} cls="t-cap" anchor="start">
                {l.sublabel}
              </T>
            )}
          </g>
        )
      })}
      {p.crossings.map((c, k) => {
        const a = index.get(c.from)
        const b = index.get(c.to)
        if (a === undefined || b === undefined || a === b) return null
        const x = L.cols[k]!
        const down = b > a
        const pts: Pt[] = kit.line(c.id, [
          [x, down ? L.bands[a]!.y + BAND_H : L.bands[a]!.y],
          [x, down ? L.bands[b]!.y : L.bands[b]!.y + BAND_H],
        ])
        const t = `edge:${c.id}`
        kit.at(t, { x: x - 6, y: Math.min(pts[0]![1], pts[1]![1]), w: 12, h: Math.abs(pts[1]![1] - pts[0]![1]) })
        return (
          <g key={c.id} {...kit.el(`crossings.${k}`, t)}>
            <Arrow pts={pts} />
            {c.label && (
              <T x={x + 5} y={(pts[0]![1] + pts[1]![1]) / 2} cls="t-small" anchor="start">
                {c.label}
              </T>
            )}
          </g>
        )
      })}
      <Decor kit={kit} badges={p.layers.map((l) => `node:${l.id}`)} />
    </TemplateSvg>
  )
}

function checkInvariants(p: Props): string[] {
  const out: string[] = []
  const ids = new Set(p.layers.map((l) => l.id))
  for (const d of duplicates([...p.layers.map((l) => l.id), ...p.crossings.map((c) => c.id)])) out.push(`id ${d} is used twice`)
  for (const d of duplicates(p.layers.map((l) => l.label))) out.push(`layer ${d} is listed twice`)
  for (const c of p.crossings) {
    for (const end of [c.from, c.to]) if (!ids.has(end)) out.push(`crossing ${c.id}: layer ${end} does not exist`)
    if (c.from === c.to) out.push(`crossing ${c.id} starts and ends in the same layer`)
  }
  return out
}

export const layersTemplate = defineTemplate<Props, Layout>({
  id: 'layers',
  description: 'A layered stack drawn as horizontal bands, top layer first, with crossings: arrows for data or calls passing from one layer to another.',
  whenToUse: 'Use for layered models and tiers: the OSI and TCP/IP stacks, encapsulation on the way down, OS kernel/user space, storage engine layers, presentation/business/data tiers. At most 8 layers and 8 crossings.',
  propsSchema: Props,
  example: {
    label: 'sending an HTTP request',
    layers: [
      { id: 'app', label: 'Application', sublabel: 'HTTP' },
      { id: 'tr', label: 'Transport', sublabel: 'TCP segment' },
      { id: 'net', label: 'Network', sublabel: 'IP packet' },
      { id: 'link', label: 'Link', sublabel: 'Ethernet frame' },
    ],
    crossings: [
      { id: 'c1', from: 'app', to: 'tr', label: 'data' },
      { id: 'c2', from: 'tr', to: 'net', label: '+TCP hdr' },
      { id: 'c3', from: 'net', to: 'link', label: '+IP hdr' },
    ],
  },
  exampleEvidence: [
    { path: 'layers', evidence: { blockId: 'b-stack-1', quote: 'each layer uses the services of the layer below it' } },
    { path: 'crossings.1', evidence: { blockId: 'b-stack-2', quote: 'TCP adds its header and hands the segment to IP' } },
  ],
  evidencePaths: '`layers` or `layers.<i>`, `crossings` or `crossings.<k>`.',
  targetsDoc: '`node:<layerId>` for a layer (`set` shows a badge, e.g. the header it adds when encapsulating); `edge:<crossingId>` for a crossing. Move a packet with `token` along crossing ids in order.',
  targets: (p) => [...p.layers.map((l) => `node:${l.id}`), ...p.crossings.map((c) => `edge:${c.id}`)],
  supportedActions: [...BASE_ACTIONS, 'set', 'token', 'pointer'],
  checkInvariants,
  dropElement(p, path) {
    const lp = listPath(path)
    if (lp?.list === 'crossings' && !lp.rest) return { ...p, crossings: without(p.crossings, lp.index) }
    if (lp?.list === 'layers' && !lp.rest && p.layers.length > 2) {
      const id = p.layers[lp.index]?.id
      return { ...p, layers: without(p.layers, lp.index), crossings: p.crossings.filter((c) => c.from !== id && c.to !== id) }
    }
    throw new TemplateDropError('layers', path)
  },
  layout,
  Component: LayersView,
})
