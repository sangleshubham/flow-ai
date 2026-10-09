// Timeline renderer (§10): horizontal lanes, events on a shared ordinal axis, cross-lane arrows.
// The chrome always shows the "simulated" badge for this kind.
import { useEffect } from 'react'

import type { TimelineIR } from '@illus/core'

import { layoutTimeline, TL } from './layout.ts'

export function TimelineView({ ir, onReady }: { ir: TimelineIR; onReady: () => void }) {
  const l = layoutTimeline(ir)
  useEffect(onReady, [ir])
  const axisY = l.height - TL.bottom + 8
  return (
    <svg className="illus-svg illus-timeline" width={l.width} height={l.height} viewBox={`0 0 ${l.width} ${l.height}`} role="img" aria-label="Simulated timeline">
      {l.lanes.map((lane) => (
        <g key={lane.id} className="illus-el illus-lane" data-ir-id={lane.id} data-target={`group:${lane.id}`}>
          <line className="illus-lane-line" x1={TL.laneLabelW - 8} x2={l.width} y1={lane.y} y2={lane.y} />
          <text x={8} y={lane.y + 4} fontSize={12} fontWeight={600}>
            {lane.label}
          </text>
        </g>
      ))}
      <line className="illus-axis" x1={TL.laneLabelW - 8} x2={l.width} y1={axisY} y2={axisY} />
      {l.ticks.map((t) => (
        <text key={t.at} className="illus-tick" x={t.x} y={axisY + 14} textAnchor="middle">
          {`t${t.at}`}
        </text>
      ))}
      {l.events.map((e) => (
        <g key={e.id} className="illus-el illus-event" data-ir-id={e.id} data-target={`node:${e.id}`} tabIndex={0} aria-label={e.lines.join(' ')}>
          {e.arrow && (
            <>
              <path className="illus-edge-line" d={`M${e.x} ${e.y} L${e.arrow.x2} ${e.arrow.y2}`} />
              <path className="illus-edge-head" d={head(e.x, e.y, e.arrow.x2, e.arrow.y2)} />
            </>
          )}
          <circle className="illus-event-dot" cx={e.x} cy={e.y} r={TL.dot} />
          <text x={e.x} y={e.y - 12 - (e.lines.length - 1) * 13} textAnchor="middle" fontSize={11}>
            {e.lines.map((line, i) => (
              <tspan key={i} x={e.x} dy={i ? 13 : 0}>
                {line}
              </tspan>
            ))}
          </text>
        </g>
      ))}
    </svg>
  )
}

function head(x1: number, y1: number, x2: number, y2: number): string {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const bx = x2 - Math.cos(a) * 8
  const by = y2 - Math.sin(a) * 8
  const px = -Math.sin(a) * 4
  const py = Math.cos(a) * 4
  return `M${x2} ${y2} L${bx + px} ${by + py} L${bx - px} ${by - py} Z`
}
