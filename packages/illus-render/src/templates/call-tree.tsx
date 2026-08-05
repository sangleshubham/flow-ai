// `call-tree` template (§10): a recursion tree with return values and memo hits (d3-hierarchy layout).
import { z } from 'zod'

import type { TemplateViewProps } from '../types.ts'

import { checkParents, layoutTree, subtree } from './hierarchy.ts'
import { BASE_ACTIONS, BOTTOM, Cell, clip, Decor, defineTemplate, Id, Kit, listPath, PAD, T, TemplateDropError, TemplateSvg, Text, textW, TOP, Val } from './kit.tsx'
import type { Box, Pt } from './kit.tsx'

const Props = z.object({
  label: Text.optional(),
  calls: z.array(z.object({ id: Id, label: Text, parent: Id.optional(), returns: Val.optional(), memo: z.boolean().optional() })).min(1).max(31),
})
type Props = z.infer<typeof Props>
interface Layout {
  width: number
  height: number
  boxes: Map<string, Box>
}

const H = 28
const callW = (label: string) => Math.max(44, textW(label, 13, true) + 16)
/** Room right of each call for its return value (mirrored on the left so boxes stay centred). */
const RET_W = 54

function layout(p: Props): Layout {
  const byParent = new Map<string, string[]>()
  for (const c of p.calls) if (c.parent) byParent.set(c.parent, [...(byParent.get(c.parent) ?? []), c.id])
  const labels = new Map(p.calls.map((c) => [c.id, c.label]))
  const root = p.calls.find((c) => !c.parent) ?? p.calls[0]!
  const t = layoutTree(root.id, (id) => byParent.get(id) ?? [], (id) => callW(labels.get(id)!) + 2 * RET_W, { gap: 4, levelH: 56 })
  const top = TOP + (p.label ? 18 : 0) + 4
  const boxes = new Map<string, Box>()
  for (const [id, pl] of t.places) {
    const w = callW(labels.get(id)!)
    boxes.set(id, { x: PAD + pl.x - w / 2, y: top + pl.y, w, h: H })
  }
  return { width: t.width + PAD * 2, height: top + t.height + H + BOTTOM, boxes }
}

function CallTreeView({ ir, props: p, layout: L, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const kit = new Kit(ir, frame)
  return (
    <TemplateSvg width={L.width} height={L.height} label={p.label ?? 'call tree'} onReady={onReady}>
      {p.label && (
        <T x={PAD} y={TOP - 4} cls="t-cap" anchor="start">
          {p.label}
        </T>
      )}
      {p.calls.map((c, i) => {
        if (!c.parent) return null
        const a = L.boxes.get(c.parent)
        const b = L.boxes.get(c.id)
        if (!a || !b) return null
        const t = `edge:${c.id}`
        const pts: Pt[] = clip(a, b, 0)
        kit.line(c.id, pts)
        return (
          <g key={t} {...kit.el(`calls.${i}`, t)}>
            <path d={`M${pts[0]!.join(',')} L${pts[1]!.join(',')}`} className={`t-link${c.memo ? ' t-dash' : ''}`} />
          </g>
        )
      })}
      {p.calls.map((c, i) => {
        const t = `node:${c.id}`
        const b = kit.at(t, L.boxes.get(c.id)!)
        const ret = kit.val(t, c.returns ?? '')
        return (
          <g key={c.id} {...kit.el(`calls.${i}`, t)}>
            <Cell box={b} text={c.label} rx={6} cls={c.memo ? 't-band' : 't-cell'} />
            {(ret !== '' || c.memo) && (
              <T x={b.x + b.w + 4} y={b.y + H / 2} cls="t-mono t-cap" anchor="start">
                {`${ret !== '' ? `→${ret}` : ''}${c.memo ? ' memo' : ''}`}
              </T>
            )}
          </g>
        )
      })}
      <Decor kit={kit} />
    </TemplateSvg>
  )
}

function checkInvariants(p: Props): string[] {
  const out = checkParents(p.calls)
  const parents = new Set(p.calls.map((c) => c.parent).filter(Boolean))
  for (const c of p.calls) if (c.memo && parents.has(c.id)) out.push(`${c.id}: a memo hit returns a cached value and makes no further calls`)
  return out
}

export const callTreeTemplate = defineTemplate<Props, Layout>({
  id: 'call-tree',
  description: 'A recursion tree: each call (e.g. "fib(3)") under the call that made it, children in call order, with its return value and whether it was answered from a memo table.',
  whenToUse: 'Use for recursive functions: Fibonacci and why memoization helps, merge sort splits, backtracking, divide and conquer, recursion depth. At most 31 calls. For data trees use `tree`.',
  propsSchema: Props,
  example: {
    label: 'fib(4) with memoization',
    calls: [
      { id: 'f4', label: 'fib(4)', returns: 3 },
      { id: 'f3', label: 'fib(3)', parent: 'f4', returns: 2 },
      { id: 'f2', label: 'fib(2)', parent: 'f3', returns: 1 },
      { id: 'f1', label: 'fib(1)', parent: 'f2', returns: 1 },
      { id: 'f0', label: 'fib(0)', parent: 'f2', returns: 0 },
      { id: 'f1b', label: 'fib(1)', parent: 'f3', returns: 1, memo: true },
      { id: 'f2b', label: 'fib(2)', parent: 'f4', returns: 1, memo: true },
    ],
  },
  exampleEvidence: [
    { path: 'calls.0', evidence: { blockId: 'b-fib-2', quote: 'fib(4) calls fib(3) and fib(2)' } },
    { path: 'calls.6', evidence: { blockId: 'b-fib-3', quote: 'the second call to fib(2) is answered from the memo' } },
    { path: 'calls', evidence: { blockId: 'b-fib-2', quote: 'each call branches into two smaller calls' } },
  ],
  evidencePaths: '`calls` or `calls.<i>`.',
  targetsDoc: '`node:<callId>` for a call (`set` shows its return value; a memo hit is `highlight` with tone success); `edge:<callId>` for the link from its caller. Hide calls initially and `reveal` them in call order.',
  targets: (p) => [...p.calls.map((c) => `node:${c.id}`), ...p.calls.filter((c) => c.parent).map((c) => `edge:${c.id}`)],
  supportedActions: [...BASE_ACTIONS, 'set', 'pointer', 'token'],
  checkInvariants,
  dropElement(p, path) {
    const lp = listPath(path)
    const c = lp?.list === 'calls' && !lp.rest ? p.calls[lp.index] : undefined
    if (c?.parent) {
      const gone = subtree(p.calls, c.id)
      return { ...p, calls: p.calls.filter((x) => !gone.has(x.id)) }
    }
    throw new TemplateDropError('call-tree', path)
  },
  layout,
  Component: CallTreeView,
})
