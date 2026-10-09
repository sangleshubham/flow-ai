// `grid` template (§10): a matrix or DP table with row/column headers and arrows between cells.
import { z } from 'zod'

import type { TemplateViewProps } from '../types.ts'

import { Arrow, BASE_ACTIONS, BOTTOM, Cell, clip, Decor, defineTemplate, duplicates, Id, Kit, listPath, PAD, T, TemplateDropError, TemplateSvg, Text, textW, TOP, Val, without } from './kit.tsx'
import type { Box } from './kit.tsx'

const Header = z.string().max(12)
const Props = z.object({
  label: Text.optional(),
  rows: z.number().int().min(1).max(12),
  cols: z.number().int().min(1).max(12),
  cells: z.array(z.array(Val.nullable()).max(12)).max(12),
  rowHeaders: z.array(Header).max(12).optional(),
  colHeaders: z.array(Header).max(12).optional(),
  arrows: z.array(z.object({ id: Id, fromRow: z.number().int(), fromCol: z.number().int(), toRow: z.number().int(), toCol: z.number().int() })).max(8).optional(),
})
type Props = z.infer<typeof Props>
interface Layout {
  width: number
  height: number
  x0: number
  y0: number
  w: number
  h: number
}

const cellT = (r: number, c: number) => `cell:r${r}[${c}]`

function layout(p: Props): Layout {
  const texts = p.cells.flat().filter((v): v is string | number => v !== null)
  const w = Math.max(30, ...texts.map((v) => textW(v, 13, true) + 14), ...(p.colHeaders ?? []).map((h) => textW(h, 11) + 10))
  const h = 28
  const rowHeadW = p.rowHeaders?.some(Boolean) ? Math.max(...p.rowHeaders.map((x) => textW(x, 11))) + 12 : 0
  const x0 = PAD + rowHeadW
  const y0 = TOP + (p.label ? 18 : 0) + (p.colHeaders?.some(Boolean) ? 18 : 0)
  return { width: x0 + p.cols * w + PAD * 2, height: y0 + p.rows * h + BOTTOM, x0, y0, w, h }
}

function GridView({ ir, props: p, layout: L, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const kit = new Kit(ir, frame)
  const box = (r: number, c: number): Box => ({ x: L.x0 + c * L.w, y: L.y0 + r * L.h, w: L.w, h: L.h })
  return (
    <TemplateSvg width={L.width} height={L.height} label={p.label ?? 'grid'} onReady={onReady}>
      {p.label && (
        <T x={PAD} y={TOP - 4} cls="t-cap" anchor="start">
          {p.label}
        </T>
      )}
      {(p.colHeaders ?? []).map((h, c) =>
        h ? (
          <g key={`ch${c}`} {...kit.ev(`colHeaders.${c}`)}>
            <T x={L.x0 + c * L.w + L.w / 2} y={L.y0 - 10} cls="t-cap t-bold">
              {h}
            </T>
          </g>
        ) : null,
      )}
      {(p.rowHeaders ?? []).map((h, r) =>
        h ? (
          <g key={`rh${r}`} {...kit.ev(`rowHeaders.${r}`)}>
            <T x={L.x0 - 6} y={L.y0 + r * L.h + L.h / 2} cls="t-cap t-bold" anchor="end">
              {h}
            </T>
          </g>
        ) : null,
      )}
      {Array.from({ length: p.rows }, (_, r) =>
        Array.from({ length: p.cols }, (_, c) => {
          const t = cellT(r, c)
          const b = kit.at(t, box(r, c))
          const v = kit.content(t, (el) => {
            const m = /^cell:r(\d+)\[(\d+)\]$/.exec(el)!
            return p.cells[Number(m[1])]?.[Number(m[2])] ?? ''
          })
          return (
            <g key={t} {...kit.el(`cells.${r}.${c}`, t)}>
              <Cell box={b} text={v ?? ''} rx={0} />
            </g>
          )
        }),
      )}
      {(p.arrows ?? []).map((a, k) => {
        const t = `edge:${a.id}`
        const pts = kit.line(a.id, clip(box(a.fromRow, a.fromCol), box(a.toRow, a.toCol), -8))
        return (
          <g key={a.id} {...kit.el(`arrows.${k}`, t)}>
            <Arrow pts={pts} curve={a.fromRow !== a.toRow && a.fromCol !== a.toCol ? 0 : 10} />
          </g>
        )
      })}
      <Decor kit={kit} />
    </TemplateSvg>
  )
}

function checkInvariants(p: Props): string[] {
  const out: string[] = []
  if (p.cells.length !== p.rows) out.push(`cells has ${p.cells.length} rows, expected ${p.rows}`)
  p.cells.forEach((row, r) => {
    if (row.length !== p.cols) out.push(`cells row ${r} has ${row.length} columns, expected ${p.cols}`)
  })
  if (p.rowHeaders && p.rowHeaders.length !== p.rows) out.push(`rowHeaders has ${p.rowHeaders.length} entries, expected ${p.rows}`)
  if (p.colHeaders && p.colHeaders.length !== p.cols) out.push(`colHeaders has ${p.colHeaders.length} entries, expected ${p.cols}`)
  for (const d of duplicates((p.arrows ?? []).map((a) => a.id))) out.push(`arrow id ${d} is used twice`)
  for (const a of p.arrows ?? []) {
    for (const [r, c] of [
      [a.fromRow, a.fromCol],
      [a.toRow, a.toCol],
    ] as const)
      if (r < 0 || r >= p.rows || c < 0 || c >= p.cols) out.push(`arrow ${a.id}: cell (${r}, ${c}) is outside the ${p.rows}×${p.cols} grid`)
    if (a.fromRow === a.toRow && a.fromCol === a.toCol) out.push(`arrow ${a.id} starts and ends in the same cell`)
  }
  return out
}

export const gridTemplate = defineTemplate<Props, Layout>({
  id: 'grid',
  description: 'A matrix or dynamic-programming table: rows × columns of cells (null = empty), optional row and column headers, and arrows from one cell to another (e.g. which subproblem a value came from).',
  whenToUse: 'Use for 2-D arrays and DP tables: edit distance, LCS, knapsack, grid paths, adjacency matrices, game boards, flood fill. At most 12 × 12. `cells[r][c]` is row r, column c.',
  propsSchema: Props,
  example: {
    label: 'edit distance: cat → cut',
    rows: 4,
    cols: 4,
    rowHeaders: ['', 'c', 'a', 't'],
    colHeaders: ['', 'c', 'u', 't'],
    cells: [
      [0, 1, 2, 3],
      [1, 0, 1, 2],
      [2, 1, 1, 2],
      [3, 2, 2, 1],
    ],
    arrows: [
      { id: 'diag1', fromRow: 2, fromCol: 2, toRow: 3, toCol: 3 },
      { id: 'diag0', fromRow: 1, fromCol: 1, toRow: 2, toCol: 2 },
    ],
  },
  exampleEvidence: [
    { path: 'cells', evidence: { blockId: 'b-edit-3', quote: 'each cell holds the distance between two prefixes' } },
    { path: 'cells.3.3', evidence: { blockId: 'b-edit-4', quote: 'the bottom-right cell gives the answer, one edit' } },
    { path: 'arrows.0', evidence: { blockId: 'b-edit-4', quote: 'matching letters copy the value from the diagonal' } },
  ],
  evidencePaths: '`cells`, `cells.<r>` (a row) or `cells.<r>.<c>`, `rowHeaders.<r>`, `colHeaders.<c>`, `arrows.<k>`.',
  targetsDoc: '`cell:r<r>[<c>]` for row r, column c (e.g. `cell:r2[3]`; `set` fills a DP cell); `edge:<arrowId>` for an arrow (hide it initially and `reveal` it to draw an arrow between cells).',
  targets: (p) => [
    ...Array.from({ length: p.rows }, (_, r) => Array.from({ length: p.cols }, (_, c) => cellT(r, c))).flat(),
    ...(p.arrows ?? []).map((a) => `edge:${a.id}`),
  ],
  supportedActions: [...BASE_ACTIONS, 'set', 'pointer', 'token'],
  checkInvariants,
  dropElement(p, path) {
    const lp = listPath(path)
    if (lp?.list === 'arrows' && !lp.rest && p.arrows) return { ...p, arrows: without(p.arrows, lp.index) }
    // An ungrounded value or header is blanked, which keeps every other cell where it is.
    if (lp?.list === 'cells' && /^\d+$/.test(lp.rest)) {
      const c = Number(lp.rest)
      return { ...p, cells: p.cells.map((row, r) => (r === lp.index ? row.map((v, j) => (j === c ? null : v)) : row)) }
    }
    if ((lp?.list === 'rowHeaders' || lp?.list === 'colHeaders') && !lp.rest) {
      const hs = p[lp.list]
      if (hs) return { ...p, [lp.list]: hs.map((h, i) => (i === lp.index ? '' : h)) }
    }
    throw new TemplateDropError('grid', path)
  },
  layout,
  Component: GridView,
})
