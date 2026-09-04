import { describe, expect, it } from 'vitest'

import { aspectRatio, checkGeometry, countCrossings } from '../geometry.ts'
import type { EdgePath, RenderGeometry } from '../geometry.ts'

const g = (o: Partial<RenderGeometry> = {}): RenderGeometry => ({ width: 400, height: 300, labels: [], edges: [], ...o })
const codes = (geo: RenderGeometry) => checkGeometry(geo).map((i) => i.code)
const line = (id: string, x1: number, y1: number, x2: number, y2: number): EdgePath => ({ id, points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] })

describe('render checks (§16 L4)', () => {
  it('passes a clean layout', () => {
    expect(codes(g({ labels: [{ id: 'a', box: { x: 0, y: 0, width: 40, height: 12 } }, { id: 'b', box: { x: 60, y: 0, width: 40, height: 12 } }] }))).toEqual([])
  })

  it('flags labels of different elements overlapping by more than 2 px, not by 2 px', () => {
    const a = { id: 'a', box: { x: 0, y: 0, width: 40, height: 12 } }
    expect(codes(g({ labels: [a, { id: 'b', box: { x: 37, y: 0, width: 40, height: 12 } }] }))).toEqual(['label-overlap'])
    expect(codes(g({ labels: [a, { id: 'b', box: { x: 38, y: 0, width: 40, height: 12 } }] }))).toEqual([])
    expect(codes(g({ labels: [a, { id: 'a', box: { x: 10, y: 0, width: 40, height: 12 } }] }))).toEqual([])
  })

  it('flags text wider than its shape', () => {
    const shape = { x: 0, y: 0, width: 80, height: 30 }
    expect(codes(g({ labels: [{ id: 'n', box: { x: -5, y: 8, width: 90, height: 12 }, shape }] }))).toEqual(['text-overflow'])
    expect(codes(g({ labels: [{ id: 'n', box: { x: 4, y: 8, width: 72, height: 12 }, shape }] }))).toEqual([])
  })

  it('flags an aspect ratio beyond 4:1 either way', () => {
    expect(aspectRatio({ width: 900, height: 200 })).toBe(4.5)
    expect(codes(g({ width: 900, height: 200 }))).toEqual(['aspect-ratio'])
    expect(codes(g({ width: 200, height: 900 }))).toEqual(['aspect-ratio'])
    expect(codes(g({ width: 800, height: 200 }))).toEqual([])
  })

  it('counts crossings but not edges meeting at a shared node', () => {
    expect(countCrossings([line('a', 0, 0, 10, 10), line('b', 0, 10, 10, 0)])).toBe(1)
    expect(countCrossings([line('a', 0, 0, 10, 10), line('b', 10, 10, 20, 0)])).toBe(0)
    expect(countCrossings([line('a', 0, 0, 10, 0), line('b', 0, 5, 10, 5)])).toBe(0)
  })

  it('asks for repair above 10 crossings', () => {
    // 6 horizontal × 2 vertical lines cross 12 times.
    const edges = [
      ...Array.from({ length: 6 }, (_, i) => line(`h${i}`, 0, 20 + i * 20, 200, 20 + i * 20)),
      line('v1', 50, 0, 50, 200),
      line('v2', 150, 0, 150, 200),
    ]
    expect(countCrossings(edges)).toBe(12)
    expect(codes(g({ edges }))).toEqual(['edge-crossings'])
    expect(codes(g({ edges: edges.slice(1) }))).toEqual([])
  })
})
