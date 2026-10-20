// Export (§10): the SVG is serialised with the theme tokens and frame styles inlined; PNG draws that
// SVG onto a canvas at 2× scale. The critic and render checks (W10) use the same functions.
import type { ThemeTokens } from '@illus/core'

import { SVG_CSS } from './styles.ts'
import { themeVars } from './theme.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'

function sizeOf(svg: SVGSVGElement): { width: number; height: number } {
  const vb = svg.viewBox?.baseVal
  if (vb && vb.width > 0 && vb.height > 0)
    return { width: vb.width, height: vb.height }
  const w = parseFloat(svg.getAttribute('width') ?? '')
  const h = parseFloat(svg.getAttribute('height') ?? '')
  if (w > 0 && h > 0) return { width: w, height: h }
  const r = svg.getBoundingClientRect()
  return { width: r.width || 300, height: r.height || 150 }
}

/** Standalone SVG markup of a rendered visual (the first `<svg>` inside `root`, or `root` itself). */
export function exportSvg(root: Element, theme: ThemeTokens): string {
  const svg = (
    root instanceof SVGSVGElement ? root : root.querySelector('svg')
  ) as SVGSVGElement | null
  if (!svg)
    throw new Error('exportSvg: nothing to export (no <svg> in this visual)')
  const { width, height } = sizeOf(svg)
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns', SVG_NS)
  clone.setAttribute('width', String(Math.ceil(width)))
  clone.setAttribute('height', String(Math.ceil(height)))
  if (!clone.getAttribute('viewBox'))
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`)
  const vars = Object.entries(themeVars(theme))
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ')
  clone.setAttribute(
    'style',
    `${vars}; font-family: ${theme.font}; color: ${theme.fg}; background: ${theme.bg}`,
  )
  clone.classList.add('illus-svg')
  const style = document.createElementNS(SVG_NS, 'style')
  style.textContent = SVG_CSS
  const bg = document.createElementNS(SVG_NS, 'rect')
  const vb = clone.viewBox.baseVal
  bg.setAttribute('x', String(vb.x))
  bg.setAttribute('y', String(vb.y))
  bg.setAttribute('width', String(vb.width))
  bg.setAttribute('height', String(vb.height))
  bg.setAttribute('fill', theme.bg)
  clone.insertBefore(bg, clone.firstChild)
  clone.insertBefore(style, clone.firstChild)
  return new XMLSerializer().serializeToString(clone)
}

/** PNG of a rendered visual at `scale` (default 2×). */
export async function exportPng(
  root: Element,
  theme: ThemeTokens,
  scale = 2,
): Promise<Blob> {
  const markup = exportSvg(root, theme)
  const doc = new DOMParser().parseFromString(
    markup,
    'image/svg+xml',
  ).documentElement
  const width = parseFloat(doc.getAttribute('width')!)
  const height = parseFloat(doc.getAttribute('height')!)
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * scale)
    canvas.height = Math.ceil(height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('exportPng: no 2D canvas')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error('exportPng: encoding failed')),
        'image/png',
      ),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Saves a string or blob as a file through a temporary link. */
export function download(
  data: string | Blob,
  filename: string,
  type = 'image/svg+xml',
): void {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
