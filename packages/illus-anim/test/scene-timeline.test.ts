import { describe, expect, it } from 'vitest'
import { readSceneGeometry } from '../src/scene-timeline.ts'

function svg(layout?: string, box?: string) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  if (layout !== undefined) el.setAttribute('data-layout', layout)
  if (box !== undefined)
    el.innerHTML = `<g data-target="node:a" data-box="${box}" />`
  return el
}
describe('scene geometry', () => {
  it('reads layout dimensions and target boxes in layout coordinates', () => {
    expect(readSceneGeometry(svg('400.5 200', '12.3 24 80 40'))).toEqual({
      full: { x: 0, y: 0, width: 400.5, height: 200 },
      boxes: { 'node:a': { x: 12.3, y: 24, width: 80, height: 40 } },
    })
  })
  it('returns null until both layout and target geometry exist', () => {
    expect(readSceneGeometry(svg())).toBeNull()
    expect(readSceneGeometry(svg(undefined, '1 2 3 4'))).toBeNull()
    expect(readSceneGeometry(svg('400 200'))).toBeNull()
  })
  it('rejects malformed and non-finite geometry', () => {
    for (const layout of ['', '400', '400 200 3', 'NaN 200', '0 200'])
      expect(readSceneGeometry(svg(layout, '1 2 3 4'))).toBeNull()
    for (const box of ['', '1 2 3', '1 2 NaN 4', '1 2 0 4'])
      expect(readSceneGeometry(svg('400 200', box))).toBeNull()
  })
})
