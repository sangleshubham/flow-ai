// `comparison` template (§10): an options × criteria table with short cell text.
import { z } from 'zod'

import type { TemplateViewProps } from '../types.ts'

import { BASE_ACTIONS, BOTTOM, Decor, defineTemplate, duplicates, Id, Kit, listPath, PAD, T, TemplateDropError, TemplateSvg, Text, TOP, without, wrap } from './kit.tsx'

const Props = z.object({
  label: Text.optional(),
  options: z.array(z.object({ id: Id, label: Text })).min(2).max(4),
  criteria: z.array(z.object({ id: Id, label: Text })).min(1).max(8),
  cells: z.array(z.object({ option: Id, criterion: Id, text: Text })).max(32),
})
type Props = z.infer<typeof Props>
interface Layout {
  width: number
  height: number
  x0: number
  colW: number
  headH: number
  rowY: number[]
  rowH: number[]
}

const WRAP = 20
const LINE = 15

function layout(p: Props): Layout {
  const cellLines = (c: string, o: string) => wrap(p.cells.find((x) => x.criterion === c && x.option === o)?.text ?? '', WRAP, 3).length
  const x0 = PAD + 130
  const colW = 160
  const headH = Math.max(...p.options.map((o) => wrap(o.label, WRAP, 2).length)) * LINE + 14
  const top = TOP + (p.label ? 18 : 0)
  const rowY: number[] = []
  const rowH: number[] = []
  let y = top + headH
  for (const c of p.criteria) {
    const h = Math.max(wrap(c.label, 18, 2).length, ...p.options.map((o) => cellLines(c.id, o.id))) * LINE + 12
    rowY.push(y)
    rowH.push(h)
    y += h
  }
  return { width: x0 + p.options.length * colW + PAD, height: y + BOTTOM, x0, colW, headH, rowY, rowH }
}

function Lines({ x, y, h, lines, cls, anchor = 'middle' }: { x: number; y: number; h: number; lines: string[]; cls?: string; anchor?: 'start' | 'middle' }) {
  const y0 = y + h / 2 - ((lines.length - 1) * LINE) / 2
  return (
    <>
      {lines.map((l, i) => (
        <T key={i} x={x} y={y0 + i * LINE} anchor={anchor} {...(cls ? { cls } : {})}>
          {l}
        </T>
      ))}
    </>
  )
}

function ComparisonView({ ir, props: p, layout: L, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const kit = new Kit(ir, frame)
  const top = L.rowY[0]! - L.headH
  const bottom = L.rowY[L.rowY.length - 1]! + L.rowH[L.rowH.length - 1]!
  const right = L.x0 + p.options.length * L.colW
  return (
    <TemplateSvg width={L.width} height={L.height} label={p.label ?? 'comparison'} onReady={onReady}>
      {p.label && (
        <T x={PAD} y={TOP - 4} cls="t-cap" anchor="start">
          {p.label}
        </T>
      )}
      {p.criteria.map((c, r) => {
        const t = `item:${c.id}`
        const b = kit.at(t, { x: PAD, y: L.rowY[r]!, w: right - PAD, h: L.rowH[r]! })
        return (
          <g key={c.id} {...kit.el(`criteria.${r}`, t)}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} className="t-region" />
            <line x1={PAD} x2={right} y1={b.y} y2={b.y} className="t-link" />
            <Lines x={PAD + 4} y={b.y} h={b.h} lines={wrap(c.label, 18, 2)} cls="t-bold" anchor="start" />
          </g>
        )
      })}
      {p.options.map((o, k) => {
        const t = `node:${o.id}`
        const x = L.x0 + k * L.colW
        kit.at(t, { x, y: top, w: L.colW, h: L.headH })
        return (
          <g key={o.id} {...kit.el(`options.${k}`, t)}>
            <rect x={x} y={top} width={L.colW} height={bottom - top} className="t-region" />
            <Lines x={x + L.colW / 2} y={top} h={L.headH} lines={wrap(o.label, WRAP, 2)} cls="t-bold" />
          </g>
        )
      })}
      {p.cells.map((cell, i) => {
        const r = p.criteria.findIndex((c) => c.id === cell.criterion)
        const k = p.options.findIndex((o) => o.id === cell.option)
        if (r < 0 || k < 0) return null
        const t = `cell:${cell.option}[${r}]`
        const b = kit.at(t, { x: L.x0 + k * L.colW + 4, y: L.rowY[r]! + 2, w: L.colW - 8, h: L.rowH[r]! - 4 })
        return (
          <g key={`${cell.option}-${cell.criterion}`} {...kit.el(`cells.${i}`, t)}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={3} className="t-region" />
            <Lines x={b.x + b.w / 2} y={b.y} h={b.h} lines={wrap(String(kit.val(t, cell.text)), WRAP, 3)} />
          </g>
        )
      })}
      <line x1={PAD} x2={right} y1={bottom} y2={bottom} className="t-link" />
      <Decor kit={kit} />
    </TemplateSvg>
  )
}

function checkInvariants(p: Props): string[] {
  const out: string[] = []
  const opts = new Set(p.options.map((o) => o.id))
  const crit = new Set(p.criteria.map((c) => c.id))
  for (const d of duplicates([...p.options.map((o) => o.id), ...p.criteria.map((c) => c.id)])) out.push(`id ${d} is used twice`)
  for (const c of p.cells) {
    if (!opts.has(c.option)) out.push(`cell for ${c.option}/${c.criterion}: option ${c.option} does not exist`)
    if (!crit.has(c.criterion)) out.push(`cell for ${c.option}/${c.criterion}: criterion ${c.criterion} does not exist`)
  }
  for (const d of duplicates(p.cells.map((c) => `${c.option}/${c.criterion}`))) out.push(`cell ${d} is given twice`)
  return out
}

export const comparisonTemplate = defineTemplate<Props, Layout>({
  id: 'comparison',
  description: 'A comparison table: options as columns, criteria as rows, and a short text per cell (≤ 40 characters). Missing cells stay empty.',
  whenToUse: 'Use when the text weighs alternatives against the same criteria: B-tree vs LSM tree, TCP vs UDP, SQL vs NoSQL, sorting algorithms by stability and complexity. 2–4 options, at most 8 criteria. Only cells the text supports.',
  propsSchema: Props,
  example: {
    label: 'storage engines',
    options: [
      { id: 'btree', label: 'B-tree' },
      { id: 'lsm', label: 'LSM tree' },
    ],
    criteria: [
      { id: 'writes', label: 'Write pattern' },
      { id: 'reads', label: 'Reads' },
      { id: 'amp', label: 'Write amplification' },
    ],
    cells: [
      { option: 'btree', criterion: 'writes', text: 'overwrites pages in place' },
      { option: 'lsm', criterion: 'writes', text: 'appends, sequential writes' },
      { option: 'btree', criterion: 'reads', text: 'one path from root to leaf' },
      { option: 'lsm', criterion: 'reads', text: 'may check several SSTables' },
      { option: 'lsm', criterion: 'amp', text: 'compaction rewrites data' },
    ],
  },
  exampleEvidence: [
    { path: 'cells.0', evidence: { blockId: 'b-engines-2', quote: 'B-trees overwrite pages on disk in place' } },
    { path: 'cells.1', evidence: { blockId: 'b-engines-3', quote: 'LSM-trees only append to files and turn writes into sequential writes' } },
    { path: 'cells.4', evidence: { blockId: 'b-engines-4', quote: 'compaction rewrites data several times' } },
  ],
  evidencePaths: '`options.<k>`, `criteria.<r>`, `cells.<i>`.',
  targetsDoc: '`node:<optionId>` for an option column, `item:<criterionId>` for a criterion row (highlight a row or column), `cell:<optionId>[<criterion index>]` for one cell.',
  targets: (p) => [
    ...p.cells.flatMap((c) => {
      const r = p.criteria.findIndex((x) => x.id === c.criterion)
      return r >= 0 ? [`cell:${c.option}[${r}]`] : []
    }),
    ...p.options.map((o) => `node:${o.id}`),
    ...p.criteria.map((c) => `item:${c.id}`),
  ],
  supportedActions: [...BASE_ACTIONS, 'set', 'pointer'],
  checkInvariants,
  dropElement(p, path) {
    const lp = listPath(path)
    if (lp?.list === 'cells' && !lp.rest) return { ...p, cells: without(p.cells, lp.index) }
    if (lp?.list === 'options' && !lp.rest && p.options.length > 2) {
      const id = p.options[lp.index]?.id
      return { ...p, options: without(p.options, lp.index), cells: p.cells.filter((c) => c.option !== id) }
    }
    if (lp?.list === 'criteria' && !lp.rest && p.criteria.length > 1) {
      const id = p.criteria[lp.index]?.id
      return { ...p, criteria: without(p.criteria, lp.index), cells: p.cells.filter((c) => c.criterion !== id) }
    }
    throw new TemplateDropError('comparison', path)
  },
  layout,
  Component: ComparisonView,
})
