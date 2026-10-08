// Timeline layout (§10): one horizontal lane per thread or node, events placed by `at` order on a shared
// axis, cross-lane messages as arrows. Pure.
import type { TimelineIR } from '@illus/core'

import { wrapLabel } from '../graph/measure.ts'

export const TL = { laneLabelW: 120, colW: 120, laneH: 72, top: 16, bottom: 28, dot: 6, wrap: 16 } as const

export interface TimelineLayout {
  width: number
  height: number
  lanes: { id: string; label: string; y: number }[]
  events: { id: string; lane: string; x: number; y: number; lines: string[]; arrow?: { x2: number; y2: number } }[]
  /** Axis ticks: one per distinct `at` value, in order. */
  ticks: { x: number; at: number }[]
}

export function layoutTimeline(ir: TimelineIR): TimelineLayout {
  const laneY = new Map(ir.lanes.map((l, i) => [l.id, TL.top + i * TL.laneH + TL.laneH / 2]))
  const ats = [...new Set(ir.events.map((e) => e.at))].sort((a, b) => a - b)
  const xOf = (at: number) => TL.laneLabelW + ats.indexOf(at) * TL.colW + TL.colW / 2
  const events = ir.events
    .filter((e) => laneY.has(e.lane))
    .map((e) => {
      const y = laneY.get(e.lane)!
      const x = xOf(e.at)
      const toY = e.to !== undefined && e.to !== e.lane ? laneY.get(e.to) : undefined
      return {
        id: e.id,
        lane: e.lane,
        x,
        y,
        lines: wrapLabel(e.label, TL.wrap, 2),
        ...(toY !== undefined ? { arrow: { x2: x + TL.colW * 0.6, y2: toY } } : {}),
      }
    })
  return {
    width: TL.laneLabelW + Math.max(1, ats.length) * TL.colW + TL.colW * 0.6,
    height: TL.top + ir.lanes.length * TL.laneH + TL.bottom,
    lanes: ir.lanes.map((l) => ({ id: l.id, label: l.label, y: laneY.get(l.id)! })),
    events,
    ticks: ats.map((at) => ({ x: xOf(at), at })),
  }
}
