// Shared pieces of the template library (§10): the W5 template shape, schema atoms, and the SVG kit
// every template draws with. Templates handle their whole FrameState themselves (their root carries
// `data-illus-frame="self"`), so the kit also draws pointers, values, annotations and tokens.
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { z } from 'zod'

import type { FrameState, Target, TemplateEvidence, TemplateIR } from '@illus/core'
import { IrId } from '@illus/core'

import { elementFrame, frameClasses } from '../elements.ts'
import type { RenderTemplate } from '../types.ts'

// ---------------------------------------------------------------- template shape

export type ContainerItem = { id: string; value: string | number }

/** What a reducer seeds frame 0 with (contract-change request, ADR 0015). */
export interface InitialFrame {
  pointers?: Record<string, Target>
  containers?: Record<string, ContainerItem[]>
}

/**
 * A W5 template: the `RenderTemplate` contract plus the docs the `extractor.template` and `animator`
 * prompts need, the set of valid animation targets, and the frame seed for containers and pointers.
 */
export interface W5Template<P, L> extends RenderTemplate<P, L> {
  /** Which element paths can carry evidence (`TemplateIR.evidence[].path`). */
  evidencePaths: string
  /** The §11 targets animations may address, in words. */
  targetsDoc: string
  /** Every valid §11 target for these props. */
  targets(props: P): string[]
  initialFrame?(props: P): InitialFrame
  /** Evidence of the worked example (illustrative quotes; real ones must be verbatim from the book). */
  exampleEvidence: TemplateEvidence[]
}

/** Identity helper that keeps `P` and `L` inferred (Next 12 cannot parse `satisfies`, ADR 0009). */
export function defineTemplate<P, L>(t: W5Template<P, L>): W5Template<P, L> {
  return t
}

/** Error thrown by `dropElement` for a path whose removal would change the meaning of other elements. */
export class TemplateDropError extends Error {
  constructor(templateId: string, path: string) {
    super(`${templateId}: element "${path}" cannot be dropped without changing other elements`)
    this.name = 'TemplateDropError'
  }
}

// ---------------------------------------------------------------- schema atoms

/** A displayed value: a number or a short string. */
export const Val = z.union([z.number(), z.string().min(1).max(16)])
export type Val = z.infer<typeof Val>
/** A pointer or variable name such as i, lo, head, slow. */
export const PtrName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_']{0,11}$/, 'must be a short identifier')
export const Id = IrId
/** A short label (≤ 40 characters, §8). */
export const Text = z.string().min(1).max(40)

/** Duplicate members of a list, for invariant messages. */
export function duplicates(xs: readonly (string | number)[]): (string | number)[] {
  const seen = new Set<string | number>()
  const dup = new Set<string | number>()
  for (const x of xs) (seen.has(x) ? dup : seen).add(x)
  return [...dup]
}

/** Parses `<list>.<index>` element paths; `null` when the path has another shape. */
export function listPath(path: string): { list: string; index: number; rest: string } | null {
  const m = /^([A-Za-z]+)\.(\d+)(?:\.(.+))?$/.exec(path)
  return m ? { list: m[1]!, index: Number(m[2]), rest: m[3] ?? '' } : null
}

/** Pointer name → `pointers.<k>` element path. */
export const ptrPaths = (pointers: readonly { name: string }[] = []): Record<string, string> =>
  Object.fromEntries(pointers.map((p, k) => [p.name, `pointers.${k}`]))

/** Index of a `cell:<name>[<i>]` target. */
export const idx = (target: string): number => Number(/\[(\d+)\]$/.exec(target)?.[1] ?? -1)

export const without =<T,>(xs: readonly T[], i: number): T[] => xs.filter((_, j) => j !== i)

// ---------------------------------------------------------------- geometry

export interface Box {
  x: number
  y: number
  w: number
  h: number
}
export type Pt = [number, number]

/** Text width estimate (layout is DOM-free and deterministic, so no canvas measuring). */
export const textW = (s: string | number, px = 13, mono = false) => String(s).length * px * (mono ? 0.62 : 0.58)

/** Greedy word wrap at `width` characters, at most `max` lines. */
export function wrap(s: string, width: number, max = 2): string[] {
  const lines: string[] = []
  let cur = ''
  for (const w of s.split(/\s+/).filter(Boolean)) {
    if (!cur) cur = w
    else if (cur.length + 1 + w.length <= width) cur += ` ${w}`
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  if (lines.length > max) {
    lines.length = max
    lines[max - 1] = `${lines[max - 1]!.slice(0, width - 1)}…`
  }
  return lines.map((l) => (l.length > width ? `${l.slice(0, width - 1)}…` : l))
}

// ---------------------------------------------------------------- frame kit

/**
 * Per-render helper: element attributes (ids, targets, frame classes), current values, and the boxes
 * and edge paths the decoration layer needs. Create one per render.
 */
export class Kit {
  readonly boxes = new Map<string, Box>()
  readonly lines = new Map<string, Pt[]>()
  readonly pointers: Record<string, string>
  private readonly evidence: Set<string>

  readonly frame: FrameState | undefined
  /** Pointer name → element path of the prop that declared it (for its evidence). */
  readonly pointerPaths: Record<string, string>

  constructor(ir: TemplateIR, frame: FrameState | undefined, seed: InitialFrame = {}, pointerPaths: Record<string, string> = {}) {
    this.frame = frame
    this.pointerPaths = pointerPaths
    this.evidence = new Set(ir.evidence.map((e) => e.path))
    this.pointers = { ...seed.pointers, ...frame?.pointers }
  }

  /** `data-ir-id`: the most specific evidence path that covers `path` (e.g. `values` covers `values.3`). */
  id(path: string): string {
    for (let p = path; ; ) {
      if (this.evidence.has(p)) return p
      const i = p.lastIndexOf('.')
      if (i < 0) return path
      p = p.slice(0, i)
    }
  }

  /** Attributes for one addressable element. */
  el(path: string, target: string, cls = '') {
    const id = this.id(path)
    const c = [cls, ...frameClasses(elementFrame(this.frame, target))].filter(Boolean).join(' ')
    return {
      'data-ir-id': id,
      'data-target': target,
      ...(c ? { className: c } : {}),
      ...(this.evidence.has(id) ? { tabIndex: 0 } : {}),
    }
  }

  /** Attributes for a decoration that carries evidence but is not an animation target (captions…). */
  ev(path: string) {
    const id = this.id(path)
    return { 'data-ir-id': id, ...(this.evidence.has(id) ? { tabIndex: 0 } : {}) }
  }

  /** Displayed value: the frame's `set` value, else the prop. */
  val<T>(target: string, fallback: T): string | number | T {
    return this.frame?.values[target] ?? fallback
  }

  /**
   * The element whose content now sits at `target` after `swap`s. Template targets name positions, and
   * a swap exchanges the contents of two positions (ADR 0015).
   */
  occupant(target: string): string {
    for (const [el, slot] of Object.entries(this.frame?.slots ?? {})) if (slot === target) return el
    return target
  }

  /** Content shown at a position: its `set` value, else the original content of its occupant. */
  content<T>(target: string, original: (el: string) => T): string | number | T {
    return this.frame?.values[target] ?? original(this.occupant(target))
  }

  container(id: string, fallback: ContainerItem[]): ContainerItem[] {
    const c = this.frame?.containers[id]
    if (!c) return fallback
    // `push`/`enqueue` of an id already present moves it (cache recency): keep the last occurrence.
    const last = new Map(c.map((it, i) => [it.id, i]))
    return c.filter((it, i) => last.get(it.id) === i)
  }

  added(): { id: string; label: string; parent?: string }[] {
    return this.frame?.added ?? []
  }

  at(target: string, box: Box): Box {
    this.boxes.set(target, box)
    return box
  }

  line(edgeId: string, pts: Pt[]): Pt[] {
    this.lines.set(edgeId, pts)
    return pts
  }
}

// ---------------------------------------------------------------- SVG pieces

export const TEMPLATE_CSS = `
.illus-tpl text { font-size: 13px; dominant-baseline: central; }
.illus-tpl .t-cell { fill: var(--illus-bg); stroke: var(--illus-fg); stroke-width: 1.25px; }
.illus-tpl .t-soft { fill: var(--illus-bg); stroke: var(--illus-line); stroke-width: 1px; }
.illus-tpl .t-band { fill: var(--illus-highlight); stroke: var(--illus-line); stroke-width: 1px; }
.illus-tpl .t-bar { fill: var(--illus-highlight); stroke: var(--illus-fg); stroke-width: 1.25px; }
.illus-tpl .t-ghost { fill: none; stroke: var(--illus-line); stroke-width: 1px; stroke-dasharray: 3 3; }
.illus-tpl .t-mono { font-family: var(--illus-mono); }
.illus-tpl text.t-small { font-size: 10px; fill: var(--illus-muted); }
.illus-tpl text.t-cap { font-size: 11px; fill: var(--illus-muted); }
.illus-tpl text.t-bold { font-weight: 600; }
.illus-tpl .t-link { fill: none; stroke: var(--illus-muted); stroke-width: 1.5px; }
.illus-tpl .t-dash { stroke-dasharray: 5 4; }
.illus-tpl .t-head { fill: var(--illus-muted); stroke: none; }
.illus-tpl .t-top { fill: none; stroke: var(--illus-accent); stroke-width: 2px; }
.illus-tpl text.t-ptr { font: 600 11px var(--illus-mono); fill: var(--illus-accent); }
.illus-tpl .t-ann rect { fill: var(--illus-bg); stroke: var(--illus-accent); stroke-width: 1px; }
.illus-tpl .t-ann text { font-size: 11px; }
.illus-tpl .t-token circle { fill: var(--illus-accent); }
.illus-tpl .t-token text { font: 600 10px var(--illus-mono); fill: var(--illus-bg); }
.illus-tpl .t-badge rect { fill: var(--illus-accent); }
.illus-tpl .t-badge text { font: 600 10px var(--illus-mono); fill: var(--illus-bg); }
.illus-tpl .t-region { fill: transparent; stroke: none; }
.illus-tpl .t-visited { fill: var(--illus-highlight); stroke: var(--illus-fg); stroke-width: 1.25px; }
.illus-tpl .t-frontier { fill: var(--illus-bg); stroke: var(--illus-accent); stroke-width: 1.5px; stroke-dasharray: 4 3; }
`

/** Root of every template: one SVG (export serialises it), marked as handling its own frames. */
export function TemplateSvg({ width, height, label, onReady, children }: { width: number; height: number; label: string; onReady?: (() => void) | undefined; children: ReactNode }) {
  useEffect(() => {
    onReady?.()
  }, [onReady])
  const w = Math.ceil(width)
  const h = Math.ceil(height)
  return (
    <svg className="illus-svg illus-tpl" data-illus-frame="self" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <style>{TEMPLATE_CSS}</style>
      {children}
    </svg>
  )
}

export function T({ x, y, children, cls, anchor = 'middle' }: { x: number; y: number; children: ReactNode; cls?: string; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <text x={x} y={y} textAnchor={anchor} {...(cls ? { className: cls } : {})}>
      {children}
    </text>
  )
}

/** Filled triangle at `to`, pointing away from `from`. */
export function head(from: Pt, to: Pt, size = 7): string {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0])
  const p = (da: number): string => `${to[0] - size * Math.cos(a + da)},${to[1] - size * Math.sin(a + da)}`
  return `${to[0]},${to[1]} ${p(0.45)} ${p(-0.45)}`
}

/** A straight or bent arrow; `curve` bends a single segment sideways by that many px. */
export function Arrow({ pts, curve = 0, dashed = false, arrowHead = true }: { pts: Pt[]; curve?: number; dashed?: boolean; arrowHead?: boolean }) {
  const a = pts[0]!
  const b = pts[pts.length - 1]!
  let d: string
  let before: Pt
  if (curve && pts.length === 2) {
    const mx = (a[0] + b[0]) / 2
    const my = (a[1] + b[1]) / 2
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const c: Pt = [mx - ((b[1] - a[1]) / len) * curve, my + ((b[0] - a[0]) / len) * curve]
    d = `M${a[0]},${a[1]} Q${c[0]},${c[1]} ${b[0]},${b[1]}`
    before = c
  } else {
    d = `M${pts.map((p) => p.join(',')).join(' L')}`
    before = pts[pts.length - 2]!
  }
  return (
    <>
      <path d={d} className={`t-link${dashed ? ' t-dash' : ''}`} />
      {arrowHead && <polygon points={head(before, b)} className="t-head" />}
    </>
  )
}

/** Shrinks a segment so it starts and ends `pad` px outside two box centres' borders. */
export function clip(a: Box, b: Box, pad = 2): [Pt, Pt] {
  const ca: Pt = [a.x + a.w / 2, a.y + a.h / 2]
  const cb: Pt = [b.x + b.w / 2, b.y + b.h / 2]
  const exit = (box: Box, from: Pt, to: Pt): Pt => {
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const tx = dx ? (box.w / 2 + pad) / Math.abs(dx) : Infinity
    const ty = dy ? (box.h / 2 + pad) / Math.abs(dy) : Infinity
    const t = Math.min(tx, ty, 1)
    return [from[0] + dx * t, from[1] + dy * t]
  }
  return [exit(a, ca, cb), exit(b, cb, ca)]
}

/** Labelled box: rect plus centred text. */
export function Cell({ box, text, cls = 't-cell', mono = true, rx = 3, sub }: { box: Box; text: string | number | undefined; cls?: string; mono?: boolean; rx?: number; sub?: string | undefined }) {
  return (
    <>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={rx} className={cls} />
      {text !== undefined && text !== '' && (
        <T x={box.x + box.w / 2} y={box.y + box.h / 2 - (sub ? 6 : 0)} {...(mono ? { cls: 't-mono' } : {})}>
          {text}
        </T>
      )}
      {sub && (
        <T x={box.x + box.w / 2} y={box.y + box.h / 2 + 9} cls="t-small">
          {sub}
        </T>
      )}
    </>
  )
}

const mid = (pts: Pt[]): Pt => {
  if (pts.length === 1) return pts[0]!
  const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]))
  let half = segs.reduce((a, b) => a + b, 0) / 2
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!
    if (half <= s || i === segs.length - 1) {
      const t = s ? Math.min(1, half / s) : 0
      const a = pts[i]!
      const b = pts[i + 1]!
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    half -= s
  }
  return pts[0]!
}

/**
 * Pointers (above their target), annotations (below), `set` badges where the template asks for them,
 * and tokens (midpoint of the last edge of their path). Draw it last.
 */
export function Decor({ kit, badges = [] }: { kit: Kit; badges?: string[] }) {
  const byTarget = new Map<string, string[]>()
  for (const [name, t] of Object.entries(kit.pointers)) byTarget.set(t, [...(byTarget.get(t) ?? []), name])
  const out: ReactNode[] = []
  for (const [t, names] of byTarget) {
    const b = kit.boxes.get(t)
    if (!b) continue
    out.push(
      <T key={`p:${t}`} x={b.x + b.w / 2} y={b.y - 9} cls="t-ptr">
        <tspan data-pointer={names.join(',')} data-for={t}>
          {names.map((n, i) => {
            const path = kit.pointerPaths[n]
            return (
              <tspan key={n} {...(path ? { 'data-ir-id': kit.id(path) } : {})}>
                {i ? `, ${n}` : n}
              </tspan>
            )
          })}
          {' ▾'}
        </tspan>
      </T>,
    )
  }
  for (const t of badges) {
    const b = kit.boxes.get(t)
    const v = kit.frame?.values[t]
    if (!b || v === undefined) continue
    const w = Math.max(18, textW(v, 10, true) + 10)
    out.push(
      <g key={`v:${t}`} className="t-badge" data-value-for={t}>
        <rect x={b.x + b.w - w / 2} y={b.y - 8} width={w} height={16} rx={8} />
        <T x={b.x + b.w} y={b.y}>
          {v}
        </T>
      </g>,
    )
  }
  for (const [t, text] of Object.entries(kit.frame?.annotations ?? {})) {
    const b = kit.boxes.get(t)
    if (!b) continue
    const w = textW(text, 11) + 10
    const cx = b.x + b.w / 2
    out.push(
      <g key={`a:${t}`} className="t-ann" data-annotation-for={t}>
        <rect x={cx - w / 2} y={b.y + b.h + 4} width={w} height={18} rx={4} />
        <T x={cx} y={b.y + b.h + 13}>
          {text}
        </T>
      </g>,
    )
  }
  for (const tok of kit.frame?.tokens ?? []) {
    const pts = kit.lines.get(tok.path[tok.path.length - 1]!)
    if (!pts) continue
    const [x, y] = mid(pts)
    out.push(
      <g key={`t:${tok.id}`} className="t-token" data-token-id={tok.id} data-token-path={tok.path.join(',')}>
        <circle cx={x} cy={y} r={tok.label ? Math.max(8, textW(tok.label, 10, true) / 2 + 4) : 6} />
        {tok.label && (
          <T x={x} y={y}>
            {tok.label}
          </T>
        )}
      </g>,
    )
  }
  return <g aria-hidden="true">{out}</g>
}

/** Room reserved above the drawing for pointer labels and on the bottom for annotations. */
export const TOP = 26
export const BOTTOM = 26
export const PAD = 8

/** Actions every template supports: emphasis, visibility, notes and camera. */
export const BASE_ACTIONS = ['highlight', 'unhighlight', 'reveal', 'hide', 'annotate', 'focus'] as const
