import { make, Q } from '@illus/core/testing'
import { describe, expect, it } from 'vitest'

import { CHART_SAMPLES, chartRows, sampleFn, toVegaLite } from '../src/chart/vega-lite.ts'

describe('sampleFn', () => {
  it('samples 64 points over the domain, endpoints included', () => {
    const pts = sampleFn('quadratic', [0, 8])
    expect(pts).toHaveLength(CHART_SAMPLES)
    expect(pts[0]).toEqual([0, 0])
    expect(pts.at(-1)).toEqual([8, 64])
  })
  it('drops non-finite values (log of 0, overflowing exponentials)', () => {
    expect(sampleFn('log', [0, 4])[0]![0]).toBeGreaterThan(0)
    expect(sampleFn('exponential', [0, 2000]).every(([, y]) => Number.isFinite(y))).toBe(true)
  })
})

describe('chartRows', () => {
  it('plots point series as given and drops non-positive y on log scales', () => {
    const ir = make.chartIR({
      logY: true,
      series: [{ name: 'measured', points: [[1, 0], [2, 4], [3, 9]], evidence: Q.appendEntries }],
    })
    expect(chartRows(ir)).toEqual([
      { series: 'measured', sid: 'series-0', x: 2, y: 4, given: true },
      { series: 'measured', sid: 'series-0', x: 3, y: 9, given: true },
    ])
  })
})

describe('toVegaLite', () => {
  it('uses theme tokens for every colour and a log scale when asked', () => {
    const tokens = make.themeTokens()
    const spec = toVegaLite(make.chartIR({ logY: true }), tokens) as {
      encoding: { y: { scale?: { type: string } }; color: { scale: { range: string[] } } }
      config: { axis: Record<string, unknown> }
    }
    expect(spec.encoding.y.scale?.type).toBe('log')
    expect(spec.encoding.color.scale.range).toEqual([tokens.accent])
    expect(Object.values(spec.config.axis).filter((v) => typeof v === 'string')).toEqual(
      expect.arrayContaining([tokens.muted, tokens.fg, tokens.line]),
    )
  })
})
