// `set-ops` template (§10): two or three overlapping sets in a fixed circle layout, members placed in
// their region, and every region addressable for highlighting.
import { useId } from 'react'
import { z } from 'zod'

import type { TemplateViewProps } from '../types.ts'

import { BASE_ACTIONS, BOTTOM, Decor, defineTemplate, duplicates, Id, Kit, listPath, PAD, T, TemplateDropError, TemplateSvg, Text, TOP, without } from './kit.tsx'

const Props = z.object({
  label: Text.optional(),
  sets: z.array(z.object({ id: Id, label: Text })).min(2).max(3),
  members: z.array(z.object({ id: Id, label: z.string().min(1).max(12), in: z.array(Id).max(3) })).max(16),
})
type Props = z.infer<typeof Props>
type Pt = [number, number]
interface Layout {
  width: number
  height: number
  r: number
  centres: Pt[]
  /** Region key (set indices joined by "+", "" = outside every set) → anchor point. */
  anchors: Map<string, Pt>
}

const LINE = 15
const MAX_PER_REGION = 5

const subsets = (n: number): number[][] => {
  const out: number[][] = []
  for (let m = 1; m < 1 << n; m++) out.push(Array.from({ length: n }, (_, i) => i).filter((i) => m & (1 << i)))
  return out
}

function layout(p: Props): Layout {
  const three = p.sets.length === 3
  const r = three ? 84 : 92
  const top = TOP + (p.label ? 18 : 0) + 20
  const cx = PAD + 200
  const centres: Pt[] = three
    ? [
        [cx - 52, top + r],
        [cx + 52, top + r],
        [cx, top + r + 88],
      ]
    : [
        [cx - 58, top + r],
        [cx + 58, top + r],
      ]
  const all: Pt = [centres.reduce((a, c) => a + c[0], 0) / centres.length, centres.reduce((a, c) => a + c[1], 0) / centres.length]
  const anchors = new Map<string, Pt>()
  for (const s of subsets(centres.length)) {
    const inC: Pt = [s.reduce((a, i) => a + centres[i]![0], 0) / s.length, s.reduce((a, i) => a + centres[i]![1], 0) / s.length]
    // Push the anchor away from the overall centre in proportion to how few sets the region is in.
    const k = s.length === centres.length ? 0 : s.length === 1 ? (three ? 0.95 : 0.75) : 0.55
    anchors.set(s.join('+'), [inC[0] + (inC[0] - all[0]) * k, inC[1] + (inC[1] - all[1]) * k])
  }
  const bottom = Math.max(...centres.map((c) => c[1])) + r
  anchors.set('', [PAD + 4, bottom + 26])
  return { width: cx * 2 - PAD + 20, height: bottom + 40 + BOTTOM, r, centres, anchors }
}

function SetOpsView({ ir, props: p, layout: L, frame, onReady }: TemplateViewProps<Props, Layout>) {
  const kit = new Kit(ir, frame)
  const uid = useId().replace(/[^A-Za-z0-9]/g, '')
  const index = new Map(p.sets.map((s, i) => [s.id, i]))
  const regionKey = (ids: readonly string[]) =>
    ids
      .map((id) => index.get(id))
      .filter((i): i is number => i !== undefined)
      .sort()
      .join('+')
  const regionTarget = (key: string) => `group:${key.split('+').map((i) => p.sets[Number(i)]!.id).join('+')}`
  const byRegion = new Map<string, number[]>()
  p.members.forEach((m, i) => {
    const k = regionKey(m.in)
    byRegion.set(k, [...(byRegion.get(k) ?? []), i])
  })
  const n = p.sets.length
  const full = { x: 0, y: 0, w: L.width, h: L.height }
  return (
    <TemplateSvg width={L.width} height={L.height} label={p.label ?? 'sets'} onReady={onReady}>
      <defs>
        {L.centres.map((c, i) => (
          <clipPath key={`c${i}`} id={`${uid}c${i}`}>
            <circle cx={c[0]} cy={c[1]} r={L.r} />
          </clipPath>
        ))}
        {L.centres.map((c, i) => (
          <mask key={`m${i}`} id={`${uid}m${i}`} maskUnits="userSpaceOnUse" x={0} y={0} width={L.width} height={L.height}>
            <rect x={0} y={0} width={L.width} height={L.height} fill="white" />
            <circle cx={c[0]} cy={c[1]} r={L.r} fill="black" />
          </mask>
        ))}
      </defs>
      {p.label && (
        <T x={PAD} y={TOP - 4} cls="t-cap" anchor="start">
          {p.label}
        </T>
      )}
      {subsets(n).map((s) => {
        const key = s.join('+')
        const t = regionTarget(key)
        const out = Array.from({ length: n }, (_, i) => i).filter((i) => !s.includes(i))
        // Intersect the circles in `s` (nested clips), then cut out the others (masks).
        let shape = <rect x={full.x} y={full.y} width={full.w} height={full.h} className="t-region" />
        for (const i of out) shape = <g mask={`url(#${uid}m${i})`}>{shape}</g>
        for (const i of s) shape = <g clipPath={`url(#${uid}c${i})`}>{shape}</g>
        const a = L.anchors.get(key)!
        kit.at(t, { x: a[0] - 20, y: a[1] - 10, w: 40, h: 20 })
        return (
          <g key={key} {...kit.el(`regions.${key}`, t)}>
            {shape}
          </g>
        )
      })}
      {p.sets.map((s, i) => {
        const [cx, cy] = L.centres[i]!
        const t = `node:${s.id}`
        // Labels sit outside the circles: left/right for the top pair, below for the third.
        const lx = i === 2 ? cx : i === 0 ? cx - L.r * 0.7 : cx + L.r * 0.7
        const ly = i === 2 ? cy + L.r + 12 : cy - L.r - 8
        kit.at(t, { x: lx - 30, y: ly - 8, w: 60, h: 16 })
        return (
          <g key={s.id} {...kit.el(`sets.${i}`, t)}>
            <circle cx={cx} cy={cy} r={L.r} fill="none" className="t-link" />
            <T x={lx} y={ly} cls="t-bold">
              {s.label}
            </T>
          </g>
        )
      })}
      {[...byRegion].map(([key, ms]) => {
        const a = L.anchors.get(key)!
        const outside = key === ''
        return ms.map((mi, k) => {
          const m = p.members[mi]!
          const t = `item:${m.id}`
          const x = outside ? a[0] + k * 62 : a[0]
          const y = outside ? a[1] : a[1] + (k - (ms.length - 1) / 2) * LINE
          kit.at(t, { x: x - 24, y: y - 7, w: 48, h: 14 })
          return (
            <g key={m.id} {...kit.el(`members.${mi}`, t)}>
              <T x={x} y={y} cls="t-mono t-cap" anchor={outside ? 'start' : 'middle'}>
                {String(kit.val(t, m.label))}
              </T>
            </g>
          )
        })
      })}
      {byRegion.has('') && (
        <T x={PAD + 4} y={L.anchors.get('')![1] - 16} cls="t-small" anchor="start">
          in no set
        </T>
      )}
      <Decor kit={kit} />
    </TemplateSvg>
  )
}

function checkInvariants(p: Props): string[] {
  const out: string[] = []
  const sets = new Set(p.sets.map((s) => s.id))
  for (const d of duplicates([...p.sets.map((s) => s.id), ...p.members.map((m) => m.id)])) out.push(`id ${d} is used twice`)
  for (const d of duplicates(p.members.map((m) => m.label))) out.push(`member ${d} is listed twice`)
  const count = new Map<string, number>()
  for (const m of p.members) {
    for (const s of m.in) if (!sets.has(s)) out.push(`member ${m.id}: set ${s} does not exist`)
    if (duplicates(m.in).length) out.push(`member ${m.id} names the same set twice`)
    const k = [...new Set(m.in)].sort().join('+')
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  for (const [k, c] of count) if (c > MAX_PER_REGION) out.push(`${c} members in region ${k || '(none)'}; at most ${MAX_PER_REGION} fit`)
  return out
}

export const setOpsTemplate = defineTemplate<Props, Layout>({
  id: 'set-ops',
  description: 'Two or three overlapping sets (Venn diagram) with their members placed in the right region; members in no set are listed underneath. Every region can be highlighted.',
  whenToUse: 'Use for set operations and overlaps: union, intersection, difference, SQL joins as sets, Bloom-filter false positives, shared vs exclusive items. At most 3 sets, 16 members, 5 per region.',
  propsSchema: Props,
  example: {
    label: 'inner join on user_id',
    sets: [
      { id: 'users', label: 'users' },
      { id: 'orders', label: 'orders' },
    ],
    members: [
      { id: 'u1', label: '1', in: ['users', 'orders'] },
      { id: 'u2', label: '2', in: ['users', 'orders'] },
      { id: 'u3', label: '3', in: ['users'] },
      { id: 'u7', label: '7', in: ['orders'] },
    ],
  },
  exampleEvidence: [
    { path: 'sets', evidence: { blockId: 'b-join-1', quote: 'an inner join keeps only rows whose key appears in both tables' } },
    { path: 'members.2', evidence: { blockId: 'b-join-2', quote: 'user 3 has no orders and is dropped' } },
  ],
  evidencePaths: '`sets` or `sets.<i>`, `members` or `members.<i>`.',
  targetsDoc: '`node:<setId>` for a set\'s circle, `item:<memberId>` for a member, and `group:<setId>+<setId>…` for one region: the sets it lies in, in the order of `sets` (e.g. `group:users+orders` is the intersection, `group:users` is users only).',
  targets: (p) => [...p.members.map((m) => `item:${m.id}`), ...p.sets.map((s) => `node:${s.id}`), ...subsets(p.sets.length).map((s) => `group:${s.map((i) => p.sets[i]!.id).join('+')}`)],
  supportedActions: [...BASE_ACTIONS, 'set', 'pointer'],
  checkInvariants,
  dropElement(p, path) {
    const lp = listPath(path)
    if (lp?.list === 'members' && !lp.rest) return { ...p, members: without(p.members, lp.index) }
    if (lp?.list === 'sets' && !lp.rest && p.sets.length > 2) {
      const id = p.sets[lp.index]?.id
      return { ...p, sets: without(p.sets, lp.index), members: p.members.map((m) => ({ ...m, in: m.in.filter((s) => s !== id) })) }
    }
    throw new TemplateDropError('set-ops', path)
  },
  layout,
  Component: SetOpsView,
})
