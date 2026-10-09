// The visual surface shared by every renderer (§10, §11):
// - pan and zoom (ctrl/⌘ + wheel or trackpad pinch, drag, two-finger pinch; double-click resets),
// - evidence hover/click/keyboard through delegation on `[data-ir-id]`,
// - FrameState decoration: classes on `[data-target]` elements plus an overlay for pointers, values,
//   annotations and tokens, and the camera for `focus`.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react'

import type { FrameState } from '@illus/core'

import { elementFrame, frameClasses } from './elements.ts'
import type { IrElement } from './elements.ts'
import type { EvidenceEvent } from './types.ts'

interface View {
  x: number
  y: number
  k: number
}

const MIN_K = 0.2
const MAX_K = 4
const MAX_FIT_H = 640
const DECOR = ['illus-hidden', 'illus-removed', 'illus-tone-focus', 'illus-tone-success', 'illus-tone-warning', 'illus-tone-muted', 'illus-new', 'illus-earlier']

export interface SurfaceProps {
  children: ReactNode
  /** `data-ir-id` → element (evidence and label). */
  elements: ReadonlyMap<string, IrElement>
  frame?: FrameState | undefined
  newIds?: readonly string[] | undefined
  /** Bumped by the renderer when its DOM changes (layout done, SVG injected). */
  version: number
  onEvidenceHover?: ((e: EvidenceEvent | null) => void) | undefined
  onEvidenceClick?: ((e: EvidenceEvent) => void) | undefined
}

interface Mark {
  key: string
  kind: 'pointer' | 'annotation' | 'value' | 'token'
  x: number
  y: number
  text: string
  attr: Record<string, string>
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function Surface({ children, elements, frame, newIds, version, onEvidenceHover, onEvidenceClick }: SurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const [fit, setFit] = useState<{ k: number; h: number }>({ k: 1, h: 120 })
  const [marks, setMarks] = useState<Mark[]>([])
  const viewRef = useRef(view)
  viewRef.current = view
  const hovered = useRef<string | null>(null)
  const drag = useRef<{ pointers: Map<number, { x: number; y: number }>; moved: boolean; dist?: number }>({ pointers: new Map(), moved: false })

  const evidenceOf = useCallback(
    (target: EventTarget | null): EvidenceEvent | null => {
      const el = (target as Element | null)?.closest?.('[data-ir-id]')
      if (!el || !canvasRef.current?.contains(el)) return null
      const item = elements.get(el.getAttribute('data-ir-id')!)
      if (!item?.evidence) return null
      return { irId: item.id, target: item.target, label: item.label, evidence: item.evidence }
    },
    [elements],
  )

  const hover = (e: EvidenceEvent | null) => {
    const id = e?.irId ?? null
    if (id === hovered.current) return
    hovered.current = id
    onEvidenceHover?.(e)
  }

  // ---------------------------------------------------------------- fit to width

  const computeFit = useCallback(() => {
    const surface = surfaceRef.current
    const canvas = canvasRef.current
    if (!surface || !canvas) return
    const w = canvas.offsetWidth
    const h = canvas.offsetHeight
    const avail = surface.clientWidth || w
    const k = w > 0 ? clamp(Math.min(1, avail / w, MAX_FIT_H / Math.max(h, 1)), MIN_K, 1) : 1
    setFit({ k, h: Math.max(80, Math.ceil(h * k)) })
    setView({ x: Math.max(0, (avail - w * k) / 2), y: 0, k })
  }, [])

  useLayoutEffect(computeFit, [version, computeFit])
  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface || typeof ResizeObserver === 'undefined') return
    let last = surface.clientWidth
    const ro = new ResizeObserver(() => {
      if (surface.clientWidth !== last) {
        last = surface.clientWidth
        computeFit()
      }
    })
    ro.observe(surface)
    return () => ro.disconnect()
  }, [computeFit])

  // ---------------------------------------------------------------- frame decoration

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const isNew = newIds ? new Set(newIds) : null
    for (const el of canvas.querySelectorAll<Element>('[data-target]')) {
      if (el.closest('[data-illus-frame="self"]')) continue
      el.classList.remove(...DECOR)
      const add = frameClasses(elementFrame(frame, el.getAttribute('data-target')!))
      if (isNew) add.push(isNew.has(el.getAttribute('data-ir-id') ?? '') ? 'illus-new' : 'illus-earlier')
      if (add.length) el.classList.add(...add)
    }
  })

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame) {
      setMarks([])
      return
    }
    const box = canvas.getBoundingClientRect()
    const k = viewRef.current.k || 1
    const find = (target: string) => {
      const el = canvas.querySelector(byTarget(target))
      return el && !el.closest('[data-illus-frame="self"]') ? el : null
    }
    const rectOf = (el: Element) => {
      const r = el.getBoundingClientRect()
      return { x: (r.left - box.left) / k, y: (r.top - box.top) / k, w: r.width / k, h: r.height / k }
    }
    const out: Mark[] = []
    const named = new Map<string, string[]>()
    for (const [name, t] of Object.entries(frame.pointers)) named.set(t, [...(named.get(t) ?? []), name])
    for (const [t, names] of named) {
      const el = find(t)
      if (!el) continue
      const r = rectOf(el)
      out.push({ key: `p:${t}`, kind: 'pointer', x: r.x + r.w / 2, y: r.y - 2, text: `${names.join(', ')} ▾`, attr: { 'data-pointer': names.join(','), 'data-for': t } })
    }
    for (const [t, value] of Object.entries(frame.values)) {
      const el = find(t)
      if (!el) continue
      const r = rectOf(el)
      out.push({ key: `v:${t}`, kind: 'value', x: r.x + r.w, y: r.y, text: String(value), attr: { 'data-value-for': t } })
    }
    for (const [t, text] of Object.entries(frame.annotations)) {
      const el = find(t)
      if (!el) continue
      const r = rectOf(el)
      out.push({ key: `a:${t}`, kind: 'annotation', x: r.x + r.w / 2, y: r.y + r.h, text, attr: { 'data-annotation-for': t } })
    }
    for (const token of frame.tokens) {
      const last = token.path.at(-1)!
      const el = find(`edge:${last}`) ?? find(`msg:${last}`)
      if (!el) continue
      const p = midpoint(el, box, k) ?? (() => {
        const r = rectOf(el)
        return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
      })()
      out.push({ key: `t:${token.id}`, kind: 'token', x: p.x, y: p.y, text: token.label ?? '', attr: { 'data-token-id': token.id, 'data-token-path': token.path.join(',') } })
    }
    setMarks(out)
    // `view.k` is read through the ref: marks live in canvas units and do not move when zooming.
  }, [frame, version])

  // ---------------------------------------------------------------- camera focus

  useEffect(() => {
    const canvas = canvasRef.current
    const surface = surfaceRef.current
    if (!canvas || !surface || !frame) return
    const target = frame.focus
    if (target === null || target === 'all') {
      computeFit()
      return
    }
    const el = canvas.querySelector(byTarget(target))
    if (!el) return
    const box = canvas.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const k0 = viewRef.current.k || 1
    const cx = (r.left - box.left + r.width / 2) / k0
    const cy = (r.top - box.top + r.height / 2) / k0
    const sw = surface.clientWidth
    const sh = surface.clientHeight
    const k = clamp(Math.min(sw / ((r.width / k0) * 2.5), sh / ((r.height / k0) * 2.5)), fit.k, 2.5)
    setView({ x: sw / 2 - cx * k, y: sh / 2 - cy * k, k })
  }, [frame?.focus, version])

  // ---------------------------------------------------------------- pan and zoom

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    // Plain wheel keeps scrolling the pane; ctrl/⌘ + wheel (and trackpad pinch, which sends ctrlKey) zooms.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const r = surface.getBoundingClientRect()
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01))
    }
    surface.addEventListener('wheel', onWheel, { passive: false })
    return () => surface.removeEventListener('wheel', onWheel)
  }, [])

  const zoomAt = (px: number, py: number, factor: number) => {
    setView((v) => {
      const k = clamp(v.k * factor, MIN_K, MAX_K)
      const f = k / v.k
      return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f }
    })
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    drag.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (drag.current.pointers.size === 1) drag.current.moved = false
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    const prev = d.pointers.get(e.pointerId)
    if (!prev) {
      hover(evidenceOf(e.target))
      return
    }
    const dx = e.clientX - prev.x
    const dy = e.clientY - prev.y
    d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (d.pointers.size === 2) {
      const [a, b] = [...d.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (d.dist) {
        const r = surfaceRef.current!.getBoundingClientRect()
        zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, dist / d.dist)
      }
      d.dist = dist
      d.moved = true
      return
    }
    if (!d.moved && Math.hypot(dx, dy) < 3) return
    if (!d.moved) (e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    d.moved = true
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }
  const onPointerUp = (e: PointerEvent) => {
    drag.current.pointers.delete(e.pointerId)
    if (drag.current.pointers.size < 2) delete drag.current.dist
  }

  const onClick = (e: MouseEvent) => {
    if (drag.current.moved) {
      drag.current.moved = false
      return
    }
    const ev = evidenceOf(e.target)
    if (ev) onEvidenceClick?.(ev)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const ev = evidenceOf(e.target)
    if (!ev) return
    e.preventDefault()
    onEvidenceClick?.(ev)
  }

  return (
    <div
      ref={surfaceRef}
      className="illus-surface"
      style={{ height: fit.h + 24 * fit.k }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => hover(null)}
      onFocus={(e) => hover(evidenceOf(e.target))}
      onBlur={() => hover(null)}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onDoubleClick={computeFit}
    >
      <div
        ref={canvasRef}
        className="illus-canvas"
        data-zoom={view.k.toFixed(3)}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        {children}
        <div className="illus-overlay" aria-hidden="true">
          {marks.map((m) => (
            <span key={m.key} className={`illus-${m.kind === 'pointer' ? 'mark' : m.kind}`} style={{ left: m.x, top: m.y }} {...m.attr}>
              {m.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Attribute selector for a §11 target (slug ids plus `:`, `[`, `]`). */
const byTarget = (t: string) => `[data-target="${t.replace(/["\\]/g, '\\$&')}"]`

/** Midpoint of an edge's path (or line) in canvas units, for tokens. */
function midpoint(el: Element, box: DOMRect, k: number): { x: number; y: number } | null {
  const geom = (el.matches('path, line') ? el : el.querySelector('path, line')) as SVGGeometryElement | null
  if (!geom || typeof geom.getTotalLength !== 'function') return null
  const len = geom.getTotalLength()
  const p = geom.getPointAtLength(len / 2)
  const m = geom.getScreenCTM()
  if (!m) return null
  return { x: (m.a * p.x + m.c * p.y + m.e - box.left) / k, y: (m.b * p.x + m.d * p.y + m.f - box.top) / k }
}
