// Graph renderer (§10): ELK layout in the worker, six node shapes, edges drawn from ELK's bend points.
// Nodes and groups may carry an AWS Architecture icon and an accent colour (ADR 0049).
import { useEffect, useMemo, useRef, useState } from 'react'

import type { FrameState, GraphIR, GraphNode, LayoutGraphFn, LayoutGraphInput, LayoutGraphResult, LayoutPoint, ThemeTokens } from '@illus/core'

import { GROUP_PADDING } from './elk.ts'
import { ICON_SVGS } from './icons.generated.ts'
import { canvasMeasure, graphLayoutInput, hasIcon, ICON_BAND, ICON_SIZE, LINE_H, nodeText, SUB_H } from './measure.ts'
import type { AddedNode } from './measure.ts'

const PAD = 8

export interface GraphViewProps {
  ir: GraphIR
  theme: ThemeTokens
  frame?: FrameState | undefined
  layout?: LayoutGraphResult | undefined
  layoutGraph: LayoutGraphFn
  onLayout?: ((l: LayoutGraphResult) => void) | undefined
  onReady: () => void
  onError: (e: unknown) => void
}

/** A cached layout is reusable when it covers exactly the nodes and edges of the input. */
function fits(l: LayoutGraphResult | undefined, input: LayoutGraphInput): l is LayoutGraphResult {
  if (!l) return false
  return (
    input.nodes.every((n) => l.nodes[n.id]) &&
    Object.keys(l.nodes).length === input.nodes.length &&
    input.edges.every((e) => l.edges[e.id])
  )
}

export function GraphView({ ir, theme, frame, layout, layoutGraph, onLayout, onReady, onError }: GraphViewProps) {
  const measure = useMemo(() => canvasMeasure(theme.font), [theme.font])
  const added: AddedNode[] = useMemo(() => frame?.added ?? [], [frame?.added])
  const input = useMemo(() => graphLayoutInput(ir, measure, added), [ir, measure, added])
  const [result, setResult] = useState<LayoutGraphResult | undefined>(() => (fits(layout, input) ? layout : undefined))
  const prev = useRef<LayoutGraphResult | undefined>(result)

  useEffect(() => {
    if (fits(result, input)) {
      onReady()
      return
    }
    if (fits(layout, input)) {
      setResult(layout)
      return
    }
    const ctrl = new AbortController()
    // Structure changed after a first layout (animation `add`): keep unchanged nodes where they were.
    const hints = prev.current ? Object.fromEntries(Object.entries(prev.current.nodes).map(([id, n]) => [id, { x: n.x, y: n.y }])) : undefined
    layoutGraph(hints ? { ...input, hints } : input, { signal: ctrl.signal }).then(
      (r) => {
        prev.current = r
        setResult(r)
        onLayout?.(r)
      },
      (e) => {
        if (!ctrl.signal.aborted) onError(e)
      },
    )
    return () => ctrl.abort()
  }, [input, layout, result])

  if (!result) return <div className="illus-note">Laying out…</div>

  const nodes = new Map<string, Pick<GraphNode, 'id' | 'label' | 'sublabel' | 'shape' | 'icon' | 'color'> & { added?: true }>(
    ir.nodes.map((n) => [n.id, n]),
  )
  for (const a of added) nodes.set(a.id, { id: a.id, label: a.label, shape: 'box', added: true })
  const groupDepth = (id: string, seen = new Set<string>()): number => {
    const g = ir.groups.find((x) => x.id === id)
    if (!g?.parent || seen.has(id)) return 0
    seen.add(id)
    return 1 + groupDepth(g.parent, seen)
  }
  const groups = [...ir.groups].sort((a, b) => groupDepth(a.id) - groupDepth(b.id))

  return (
    <svg
      className="illus-svg illus-graph"
      width={result.width + PAD * 2}
      height={result.height + PAD * 2}
      viewBox={`${-PAD} ${-PAD} ${result.width + PAD * 2} ${result.height + PAD * 2}`}
      role="img"
      aria-label={ir.title}
    >
      {groups.map((g) => {
        const b = result.nodes[g.id]
        if (!b) return null
        const icon = g.icon ? ICON_SVGS[g.icon] : undefined
        return (
          <g key={g.id} className="illus-el illus-group" data-ir-id={g.id} data-target={`group:${g.id}`} data-color={g.color} tabIndex={0} aria-label={g.label}>
            <rect className="illus-group-box" x={b.x} y={b.y} width={b.width} height={b.height} rx={8} />
            {icon && <Icon name={g.icon!} x={b.x + GROUP_PADDING.side} y={b.y + 6} size={16} />}
            <text className="illus-group-label" x={b.x + GROUP_PADDING.side + (icon ? 21 : 0)} y={b.y + 18}>
              {g.label}
            </text>
          </g>
        )
      })}
      {ir.edges.map((e) => {
        const r = result.edges[e.id]
        if (!r || r.points.length < 2) return null
        return (
          <g
            key={e.id}
            className={`illus-el illus-edge${e.style === 'dashed' ? ' illus-dashed' : ''}`}
            data-ir-id={e.id}
            data-target={`edge:${e.id}`}
            tabIndex={0}
            aria-label={e.label ?? `${e.from} to ${e.to}`}
          >
            <path className="illus-edge-line" d={polyline(r.points)} />
            <path className="illus-edge-head" d={arrowHead(r.points)} />
            {e.label && r.label && <EdgeLabel text={e.label} at={r.label} />}
          </g>
        )
      })}
      {Object.entries(result.edges)
        .filter(([id]) => id.includes('->'))
        .map(([id, r]) => (
          <g key={id} className="illus-edge" data-target={`edge:${id}`}>
            <path className="illus-edge-line" d={polyline(r.points)} />
            <path className="illus-edge-head" d={arrowHead(r.points)} />
          </g>
        ))}
      {[...nodes.values()].map((n) => {
        const b = result.nodes[n.id]
        if (!b) return null
        return (
          <g
            key={n.id}
            className="illus-el illus-node"
            data-ir-id={n.id}
            data-target={`node:${n.id}`}
            data-shape={n.shape}
            data-color={n.color}
            transform={`translate(${b.x}, ${b.y})`}
            tabIndex={n.added ? undefined : 0}
            aria-label={n.label}
          >
            <Shape shape={n.shape} w={b.width} h={b.height} icon={hasIcon(n)} />
            {hasIcon(n) && <Icon name={n.icon!} x={iconX(n.shape, b.width)} y={iconY(n.shape)} size={ICON_SIZE} />}
            <NodeLabel node={n} w={b.width} h={b.height} />
          </g>
        )
      })}
    </svg>
  )
}

function polyline(points: LayoutPoint[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
}

/** Filled triangle at the last point, aligned with the last segment. */
function arrowHead(points: LayoutPoint[]): string {
  const end = points.at(-1)!
  const before = points.at(-2)!
  const a = Math.atan2(end.y - before.y, end.x - before.x)
  const len = 8
  const half = 4
  const bx = end.x - Math.cos(a) * len
  const by = end.y - Math.sin(a) * len
  const px = -Math.sin(a) * half
  const py = Math.cos(a) * half
  return `M${end.x} ${end.y} L${bx + px} ${by + py} L${bx - px} ${by - py} Z`
}

function EdgeLabel({ text, at }: { text: string; at: LayoutPoint }) {
  const w = text.length * 6.2 + 8
  return (
    <>
      <rect className="illus-label-bg" x={at.x - w / 2} y={at.y - 8} width={w} height={16} rx={3} />
      <text className="illus-edge-label" x={at.x} y={at.y + 4} textAnchor="middle">
        {text}
      </text>
    </>
  )
}

/** Icon centre column: the front box of a queue is 8 px narrower. */
const iconX = (shape: GraphNode['shape'], w: number) => (shape === 'queue' ? (w - 8) / 2 : w / 2) - ICON_SIZE / 2
/** Icon top: below a store's lid and a queue's back box. */
const iconY = (shape: GraphNode['shape']) => (shape === 'store' ? 14 : shape === 'queue' ? 14 : 6)

/** One catalog icon. The markup is generated from the AWS package and holds plain shapes only. */
function Icon({ name, x, y, size }: { name: string; x: number; y: number; size: number }) {
  const icon = ICON_SVGS[name]
  if (!icon) return null
  return (
    <svg className="illus-icon" x={x} y={y} width={size} height={size} viewBox={icon.viewBox} aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon.body }} />
  )
}

function Shape({ shape, w, h, icon }: { shape: GraphNode['shape']; w: number; h: number; icon: boolean }) {
  // With an icon, an actor is a box: the icon (a user, a client) replaces the stick figure.
  if (icon && shape === 'actor') return <rect className="illus-shape" width={w} height={h} rx={6} />
  switch (shape) {
    case 'box':
      return <rect className="illus-shape" width={w} height={h} rx={6} />
    case 'store': {
      const ry = 6
      return (
        <>
          <path className="illus-shape" d={`M0 ${ry} A${w / 2} ${ry} 0 0 1 ${w} ${ry} V${h - ry} A${w / 2} ${ry} 0 0 1 0 ${h - ry} Z`} />
          <path className="illus-shape" d={`M0 ${ry} A${w / 2} ${ry} 0 0 0 ${w} ${ry}`} fill="none" />
        </>
      )
    }
    case 'actor': {
      const cx = w / 2
      return (
        <>
          <rect className="illus-shape" y={30} width={w} height={h - 30} rx={6} />
          <circle className="illus-glyph" cx={cx} cy={6} r={5} />
          <path className="illus-glyph" d={`M${cx} 11 V21 M${cx - 8} 15 H${cx + 8} M${cx} 21 L${cx - 6} 29 M${cx} 21 L${cx + 6} 29`} />
        </>
      )
    }
    case 'queue':
      return (
        <>
          <rect className="illus-shape-back" x={8} y={0} width={w - 8} height={h - 8} rx={4} />
          <rect className="illus-shape" x={0} y={8} width={w - 8} height={h - 8} rx={4} />
        </>
      )
    case 'decision':
      return <polygon className="illus-shape" points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`} />
    case 'note':
      return (
        <>
          <path className="illus-shape" d={`M0 0 H${w - 12} L${w} 12 V${h} H0 Z`} />
          <path className="illus-shape" d={`M${w - 12} 0 V12 H${w}`} fill="none" />
        </>
      )
  }
}

/** Text block centred in the shape's text area (below the actor glyph, inside the front queue box). */
function NodeLabel({ node, w, h }: { node: Pick<GraphNode, 'label' | 'sublabel' | 'shape' | 'icon'>; w: number; h: number }) {
  const t = nodeText(node)
  const icon = hasIcon(node)
  const area =
    node.shape === 'actor'
      ? { top: icon ? ICON_BAND : 30, bottom: h, cx: w / 2 }
      : node.shape === 'queue'
        ? { top: 8 + (icon ? ICON_BAND : 0), bottom: h, cx: (w - 8) / 2 }
        : { top: (icon ? ICON_BAND : 0) + (icon && node.shape === 'store' ? 8 : 0), bottom: h, cx: w / 2 }
  const block = t.lines.length * LINE_H + (t.sublabel ? SUB_H : 0)
  const y0 = area.top + (area.bottom - area.top - block) / 2 + 12
  return (
    <text textAnchor="middle" fontSize={13}>
      {t.lines.map((l, i) => (
        <tspan key={i} x={area.cx} y={y0 + i * LINE_H}>
          {l}
        </tspan>
      ))}
      {t.sublabel && (
        <tspan className="illus-sub" x={area.cx} y={y0 + t.lines.length * LINE_H} fontSize={11}>
          {t.sublabel}
        </tspan>
      )}
    </text>
  )
}
