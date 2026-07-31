// ChartIR → Vega-Lite (§10): `fn` series sampled at 64 points over `domain`, `points` plotted as given,
// config from theme tokens. Pure.
import type { ChartFn, ChartIR, ThemeTokens } from '@illus/core'

export const CHART_SAMPLES = 64

const FNS: Record<ChartFn, (x: number) => number> = {
  constant: () => 1,
  log: (x) => Math.log2(x),
  linear: (x) => x,
  nlogn: (x) => x * Math.log2(x),
  quadratic: (x) => x * x,
  cubic: (x) => x ** 3,
  exponential: (x) => 2 ** x,
}

/** `n` evenly spaced samples of `fn` over `[a, b]`; non-finite values are dropped. */
export function sampleFn(fn: ChartFn, [a, b]: readonly [number, number], n = CHART_SAMPLES): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const x = a + ((b - a) * i) / (n - 1)
    const y = FNS[fn](x)
    if (Number.isFinite(y)) out.push([x, y])
  }
  return out
}

export interface ChartRow {
  series: string
  /** `series-${i}`: the series' data-ir-id (src/elements.ts). */
  sid: string
  x: number
  y: number
  given: boolean
}

export function chartRows(ir: ChartIR): ChartRow[] {
  return ir.series.flatMap((s, i) => {
    const pts = s.fn ? sampleFn(s.fn, ir.domain) : (s.points ?? [])
    return pts
      .filter(([, y]) => !ir.logY || y > 0)
      .map(([x, y]) => ({ series: s.name, sid: `series-${i}`, x, y, given: !s.fn }))
  })
}

/** Series colours come from tokens only; dashes keep series apart without colour. */
const DASHES = [[1, 0], [6, 3], [2, 2], [8, 3, 2, 3]]

export function toVegaLite(ir: ChartIR, t: ThemeTokens): Record<string, unknown> {
  const names = ir.series.map((s) => s.name)
  const palette = [t.accent, t.new, t.earlier, t.muted]
  const encoding = {
    x: { field: 'x', type: 'quantitative', title: ir.xLabel, scale: { domain: [...ir.domain], nice: false } },
    y: { field: 'y', type: 'quantitative', title: ir.yLabel, ...(ir.logY ? { scale: { type: 'log' } } : {}) },
    color: { field: 'series', type: 'nominal', title: null, scale: { domain: names, range: palette.slice(0, names.length) } },
    strokeDash: { field: 'series', type: 'nominal', title: null, scale: { domain: names, range: DASHES.slice(0, names.length) } },
    description: { field: 'sid', type: 'nominal' },
  }
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    width: 'container',
    height: 220,
    autosize: { type: 'fit', contains: 'padding' },
    data: { values: chartRows(ir) },
    encoding,
    layer: [
      { mark: { type: 'line', strokeWidth: 2 } },
      { mark: { type: 'point', filled: true, size: 36 }, transform: [{ filter: { field: 'given', equal: true } }] },
    ],
    config: {
      background: null,
      font: t.font,
      view: { stroke: null },
      axis: { labelColor: t.muted, titleColor: t.fg, domainColor: t.line, gridColor: t.line, tickColor: t.line, gridOpacity: 0.6 },
      legend: { labelColor: t.fg, titleColor: t.fg, orient: 'bottom' },
      title: { color: t.fg },
    },
  }
}
