// Chart renderer (§10): Vega-Lite through vega-embed, SVG renderer, no actions, and the CSP-safe
// expression interpreter (ADR 0001: no 'unsafe-eval').
import { useEffect, useRef } from 'react'
import embed from 'vega-embed'
import { expressionInterpreter } from 'vega-interpreter'

import type { ChartIR, ThemeTokens } from '@illus/core'

import { resolveTokens } from '../theme.ts'

import { toVegaLite } from './vega-lite.ts'

export interface ChartViewProps {
  ir: ChartIR
  theme: ThemeTokens
  onReady: () => void
  onError: (e: unknown) => void
}

/** Tags each series' line and points with its `data-ir-id` (`series-${i}`), read from the mark's aria label. */
export function tagChart(root: Element): void {
  for (const el of root.querySelectorAll('[aria-label]')) {
    const m = /series-\d+/.exec(el.getAttribute('aria-label') ?? '')
    if (!m || !el.closest('.mark-line, .mark-symbol')) continue
    el.setAttribute('data-ir-id', m[0])
    el.setAttribute('data-target', `item:${m[0]}`)
    el.classList.add('illus-el')
    if (el.closest('.mark-line')) el.setAttribute('tabindex', '0')
  }
}

export function ChartView({ ir, theme, onReady, onError }: ChartViewProps) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    let live = true
    let finalize: (() => void) | undefined
    const spec = { ...toVegaLite(ir, resolveTokens(theme)), width: 480 }
    embed(host.current, spec as never, { renderer: 'svg', actions: false, ast: true, expr: expressionInterpreter, tooltip: false }).then(
      (res) => {
        finalize = () => res.finalize()
        if (!live) return finalize()
        tagChart(host.current!)
        onReady()
      },
      (e) => live && onError(e),
    )
    return () => {
      live = false
      finalize?.()
    }
  }, [ir, theme])
  return <div ref={host} className="illus-chart" />
}
