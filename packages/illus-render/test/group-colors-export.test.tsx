// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LayoutGraphResult } from '@illus/core'
import { make, Q } from '@illus/core/testing'

import { exportPng, exportSvg } from '../src/export.ts'
import { GraphView } from '../src/graph/GraphView.tsx'
import { GROUP_PALETTE } from '../src/graph/palette.ts'
import { SVG_CSS } from '../src/styles.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const ir = make.graphIR({
  groups: [
    { id: 'outer', label: 'Outer', evidence: Q.request },
    { id: 'inner', label: 'Inner', parent: 'outer', evidence: Q.request },
  ],
  nodes: [
    { id: 'a', label: 'A', shape: 'box', group: 'outer', evidence: Q.request },
    { id: 'b', label: 'B', shape: 'box', group: 'inner', evidence: Q.request },
  ],
  edges: [],
})
const layout: LayoutGraphResult = {
  width: 240,
  height: 200,
  nodes: {
    outer: { x: 0, y: 0, width: 240, height: 200 },
    inner: { x: 12, y: 90, width: 216, height: 98 },
    a: { x: 12, y: 30, width: 80, height: 40 },
    b: { x: 24, y: 120, width: 80, height: 40 },
  },
  edges: {},
}

describe('group colours in exports', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`embeds resolved ${mode} variables, colour hooks and SVG rules without changing the source`, () => {
      const theme = make.themeTokens({ dark: mode === 'dark' })
      const { container } = render(
        <GraphView
          ir={ir}
          theme={theme}
          layout={layout}
          layoutGraph={vi.fn()}
          onReady={vi.fn()}
          onError={vi.fn()}
        />,
      )
      const svg = container.querySelector('svg')!
      const before = svg.outerHTML
      const doc = new DOMParser().parseFromString(
        exportSvg(svg, theme),
        'image/svg+xml',
      )
      expect(doc.querySelector('parsererror')).toBeNull()
      expect(doc.querySelector('style')!.textContent).toBe(SVG_CSS)
      for (const [name, entry] of Object.entries(GROUP_PALETTE[mode])) {
        const style = doc.documentElement.getAttribute('style')!
        expect(style).toContain(`--illus-${name}-fill: ${entry.fill}`)
        expect(style).toContain(`--illus-${name}-node-fill: ${entry.nodeFill}`)
        expect(style).toContain(`--illus-${name}-ink: ${entry.ink}`)
      }
      for (const [id, color] of [
        ['group:outer', 'blue'],
        ['group:inner', 'green'],
        ['node:a', 'blue'],
        ['node:b', 'green'],
      ]) {
        expect(
          doc
            .querySelector(`[data-target="${id}"]`)!
            .getAttribute('data-color'),
        ).toBe(color)
      }
      expect(svg.outerHTML).toBe(before)
    })
  }

  it('passes the complete themed SVG to the PNG image decoder before drawing', async () => {
    const theme = make.themeTokens({ dark: true })
    const { container } = render(
      <GraphView
        ir={ir}
        theme={theme}
        layout={layout}
        layoutGraph={vi.fn()}
        onReady={vi.fn()}
        onError={vi.fn()}
      />,
    )
    const source = container.querySelector('svg')!
    const expected = exportSvg(source, theme)
    let svgBlob: Blob | undefined
    const revoke = vi.fn()
    vi.stubGlobal(
      'URL',
      class extends URL {
        static override createObjectURL(blob: Blob): string {
          svgBlob = blob
          return 'blob:group-colors'
        }
        static override revokeObjectURL = revoke
      },
    )
    const decode = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        decode = decode
      },
    )
    const scale = vi.fn()
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      scale,
      drawImage,
    } as unknown as CanvasRenderingContext2D)
    const png = new Blob(['encoded png'], { type: 'image/png' })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      (callback) => callback(png),
    )
    expect(await exportPng(source, theme)).toBe(png)
    const markup = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsText(svgBlob!)
    })
    expect(markup).toBe(expected)
    expect(decode).toHaveBeenCalledOnce()
    expect(scale).toHaveBeenCalledWith(2, 2)
    expect(drawImage).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:group-colors')
  })
})
