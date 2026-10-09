// `pipeline` template (§10): stages left to right with the items currently in each.
import { z } from 'zod'

import type { TemplateViewProps } from '../types.ts'

import { Arrow, BASE_ACTIONS, BOTTOM, Decor, defineTemplate, duplicates, Id, Kit, listPath, PAD, T, TemplateDropError, TemplateSvg, Text, textW, TOP, without, wrap } from './kit.tsx'
import type { Box, Pt } from './kit.tsx'

const Props = z.object({
  label: Text.optional(),
  stages: z.array(z.object({ id: Id, label: Text })).min(1).max(7),
  items: z.array(z.object({ id: Id, label: z.string().min(1).max(12), stage: Id })).max(12),
})
type Props = z.infer<typeof Props>
type Item = { id: string; label: string; stage: string; path: string }
interface Layout {
  width: number
  height: number
  stages: Box[]
}

const GAP = 34
const PILL_H = 20
const edgeId = (a: string, b: string) => `${a}--${b}`

function place(p: Props, items: readonly Item[]): Layout {
  const top = TOP + (p.label ? 18 : 0)
  const perStage = p.stages.map((s) => items.filter((i) => i.stage === s.id).length)
  const h = 44 + Math.max(1, ...perStage) * (PILL_H + 4)
  let x = PAD
  const stages = p.stages.map((s) => {
    const lines = wrap(s.label, 16)
    const w = Math.max(84, ...lines.map((l) => textW(l, 13) + 18), ...items.filter((i) => i.stage === s.id).map((i) => textW(i.label, 11, true) + 26))
    const b = { x, y: top, w, h }
    x += w + GAP
    return b
  })
  return { width: x - GAP + PAD, height: top + h + BOTTOM, stages }
}

const itemsOf = (p: Props): Item[] => p.items.map((it, i) => ({ ...it, path: `items.${i}` }))
const layout = (p: Props) => place(p, itemsOf(p))

function PipelineView({ ir, props: p, layout: base, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const kit = new Kit(ir, frame)
  const stageIds = new Set(p.stages.map((s) => s.id))
  // `set` on an item with a stage id moves it there; `add` puts a new item into its `parent` stage.
  const items = [...itemsOf(p), ...kit.added().filter((a) => a.parent && stageIds.has(a.parent)).map((a) => ({ id: a.id, label: a.label, stage: a.parent!, path: `added.${a.id}` }))].map((it) => {
    const v = kit.frame?.values[`item:${it.id}`]
    return v !== undefined && stageIds.has(String(v)) ? { ...it, stage: String(v) } : it
  })
  const moved = items.some((it, i) => it.stage !== p.items[i]?.stage) || items.length !== p.items.length
  const L = moved ? place(p, items) : base
  return (
    <TemplateSvg width={L.width} height={L.height} label={p.label ?? 'pipeline'} onReady={onReady}>
      {p.label && (
        <T x={PAD} y={TOP - 4} cls="t-cap" anchor="start">
          {p.label}
        </T>
      )}
      {p.stages.slice(1).map((s, i) => {
        const a = L.stages[i]!
        const b = L.stages[i + 1]!
        const id = edgeId(p.stages[i]!.id, s.id)
        const pts: Pt[] = kit.line(id, [
          [a.x + a.w, a.y + 22],
          [b.x, b.y + 22],
        ])
        return (
          <g key={id} {...kit.el(`stages.${i + 1}`, `edge:${id}`)}>
            <Arrow pts={pts} />
          </g>
        )
      })}
      {p.stages.map((s, i) => {
        const t = `node:${s.id}`
        const b = kit.at(t, L.stages[i]!)
        const lines = wrap(s.label, 16)
        return (
          <g key={s.id} {...kit.el(`stages.${i}`, t)}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} className="t-cell" />
            {lines.map((l, k) => (
              <T key={k} x={b.x + b.w / 2} y={b.y + 14 + k * 15 - (lines.length - 1) * 4} cls="t-bold">
                {l}
              </T>
            ))}
          </g>
        )
      })}
      {p.stages.map((s, si) =>
        items
          .filter((it) => it.stage === s.id)
          .map((it, k) => {
            const sb = L.stages[si]!
            const t = `item:${it.id}`
            const v = kit.frame?.values[t]
            const text = v !== undefined && !stageIds.has(String(v)) ? String(v) : it.label
            const w = Math.max(40, textW(text, 11, true) + 16)
            const b = kit.at(t, { x: sb.x + sb.w / 2 - w / 2, y: sb.y + 38 + k * (PILL_H + 4), w, h: PILL_H })
            return (
              <g key={it.id} {...kit.el(it.path, t)}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={PILL_H / 2} className="t-band" />
                <T x={b.x + b.w / 2} y={b.y + PILL_H / 2} cls="t-mono t-cap">
                  {text}
                </T>
              </g>
            )
          }),
      )}
      <Decor kit={kit} badges={p.stages.map((s) => `node:${s.id}`)} />
    </TemplateSvg>
  )
}

function checkInvariants(p: Props): string[] {
  const out: string[] = []
  const stages = new Set(p.stages.map((s) => s.id))
  for (const d of duplicates([...p.stages.map((s) => s.id), ...p.items.map((i) => i.id)])) out.push(`id ${d} is used twice`)
  for (const it of p.items) if (!stages.has(it.stage)) out.push(`item ${it.id}: stage ${it.stage} does not exist`)
  return out
}

export const pipelineTemplate = defineTemplate<Props, Layout>({
  id: 'pipeline',
  description: 'A linear pipeline: stages from left to right, each showing the items (requests, instructions, records, packets) currently in it.',
  whenToUse: 'Use for staged processing where items move through fixed steps: CPU instruction pipelines, build and CI stages, stream processing, middleware chains, ETL. Animate items moving with `set`. At most 7 stages and 12 items. For branching data flow use kind `graph`.',
  propsSchema: Props,
  example: {
    label: 'classic RISC pipeline',
    stages: [
      { id: 'IF', label: 'Fetch' },
      { id: 'ID', label: 'Decode' },
      { id: 'EX', label: 'Execute' },
      { id: 'MEM', label: 'Memory' },
      { id: 'WB', label: 'Write back' },
    ],
    items: [
      { id: 'i4', label: 'add', stage: 'IF' },
      { id: 'i3', label: 'sub', stage: 'ID' },
      { id: 'i2', label: 'lw', stage: 'EX' },
      { id: 'i1', label: 'or', stage: 'MEM' },
    ],
  },
  exampleEvidence: [
    { path: 'stages', evidence: { blockId: 'b-pipe-1', quote: 'five stages: fetch, decode, execute, memory access and write back' } },
    { path: 'items.2', evidence: { blockId: 'b-pipe-2', quote: 'while the load executes, the next instruction is decoded' } },
  ],
  evidencePaths: '`stages` or `stages.<i>`, `items` or `items.<i>`.',
  targetsDoc: '`node:<stageId>` for a stage (a stall is `highlight` with tone warning); `item:<itemId>` for an item (`set` it to a stage id to move it); `edge:<fromStage>--<toStage>` between consecutive stages (for `token`). `add` puts a new item into its `parent` stage.',
  targets: (p) => [...p.stages.map((s) => `node:${s.id}`), ...p.items.map((i) => `item:${i.id}`), ...p.stages.slice(1).map((s, i) => `edge:${edgeId(p.stages[i]!.id, s.id)}`)],
  supportedActions: [...BASE_ACTIONS, 'set', 'add', 'remove', 'token', 'pointer'],
  checkInvariants,
  dropElement(p, path) {
    const lp = listPath(path)
    if (lp?.list === 'items' && !lp.rest) return { ...p, items: without(p.items, lp.index) }
    if (lp?.list === 'stages' && !lp.rest && p.stages.length > 1) {
      const id = p.stages[lp.index]?.id
      return { ...p, stages: without(p.stages, lp.index), items: p.items.filter((i) => i.stage !== id) }
    }
    throw new TemplateDropError('pipeline', path)
  },
  layout,
  Component: PipelineView,
})
