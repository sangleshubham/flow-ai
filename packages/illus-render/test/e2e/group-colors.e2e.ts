import { expect, test } from '@playwright/test'

import { GROUP_PALETTE } from '../../src/graph/palette.ts'
import { open } from './helpers.ts'

test('group colours, membership and labels follow a live Flow dark-class toggle', async ({
  page,
}) => {
  const { errors } = await open(page, 'graph-groups')
  await expect(page.locator('.illus-group')).toHaveCount(7)
  const colors = await page
    .locator('.illus-group[data-ir-id^="region"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-color')))
  expect(new Set(colors).size).toBe(6)
  const parent = page.locator('[data-target="group:region0"]')
  const nested = page.locator('[data-target="group:nested"]')
  expect(await nested.getAttribute('data-color')).not.toBe(
    await parent.getAttribute('data-color'),
  )
  for (let i = 0; i < 6; i++) {
    expect(
      await page
        .locator(`[data-target="node:n${i}"]`)
        .getAttribute('data-color'),
    ).toBe(colors[i])
  }
  await expect(
    page.locator('[data-target="node:explicit-node"]'),
  ).toHaveAttribute('data-color', 'purple')
  await expect(
    page.locator('[data-target="node:nested-node"]'),
  ).toHaveAttribute('data-color', (await nested.getAttribute('data-color'))!)
  const edge = page.locator('.illus-edge-line')
  expect(await edge.getAttribute('data-color')).toBeNull()

  for (const mode of ['light', 'dark'] as const) {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      mode === 'dark',
    )
    const palette = GROUP_PALETTE[mode]
    for (const [name, entry] of Object.entries(palette)) {
      const groupBox = page
        .locator(`.illus-group[data-color="${name}"] .illus-group-box`)
        .first()
      await expect(groupBox).toHaveCSS('fill', rgb(entry.fill))
      await expect(groupBox).toHaveCSS('stroke', rgb(entry.ink))
      await expect(
        page
          .locator(`.illus-group[data-color="${name}"] .illus-group-label`)
          .first(),
      ).toHaveCSS('fill', rgb(entry.ink))
      await expect(
        page.locator(`.illus-node[data-color="${name}"] .illus-shape`).first(),
      ).toHaveCSS('fill', rgb(entry.nodeFill))
      await expect(
        page.locator(`.illus-node[data-color="${name}"] .illus-sub`).first(),
      ).toHaveCSS('fill', rgb(entry.ink))
    }
    await expect(edge).toHaveCSS(
      'stroke',
      await page.locator('.illus-view').evaluate((el) => {
        // Resolve the existing edge token independently of group/node palette variables.
        const probe = document.createElement('span')
        probe.style.color = 'var(--illus-muted)'
        el.append(probe)
        const value = getComputedStyle(probe).color
        probe.remove()
        return value
      }),
    )
  }
  expect(errors).toEqual([])
})

function rgb(hex: string): string {
  return `rgb(${hex
    .slice(1)
    .match(/../g)!
    .map((c) => parseInt(c, 16))
    .join(', ')})`
}

for (const mode of ['light', 'dark'] as const) {
  test(`${mode}: standalone SVG and PNG retain every group tint`, async ({
    page,
  }) => {
    await open(page, 'graph-groups', mode)
    const samples = await page.evaluate(async () => {
      const svg = document.querySelector<SVGSVGElement>('.illus-graph')!
      const markup = window.__exportSvg()
      const svgBlob = new Blob([markup], { type: 'image/svg+xml' })
      const pngBlob = await window.__exportPngBlob(1)
      const points = Array.from(
        svg.querySelectorAll<SVGRectElement>('.illus-group-box'),
      ).map((box) => ({
        color: box.closest('[data-color]')!.getAttribute('data-color')!,
        x: box.x.baseVal.value + 10 - svg.viewBox.baseVal.x,
        y:
          box.y.baseVal.value +
          box.height.baseVal.value -
          10 -
          svg.viewBox.baseVal.y,
      }))
      const images = []
      for (const blob of [svgBlob, pngBlob]) {
        // Decode each standalone artifact independently of the live document's styles.
        const url = URL.createObjectURL(blob)
        try {
          const image = new Image()
          image.src = url
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(image, 0, 0)
          images.push(
            points.map((p) => ({
              color: p.color,
              pixel: [
                ...ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1)
                  .data,
              ],
            })),
          )
        } finally {
          URL.revokeObjectURL(url)
        }
      }
      return images
    })
    for (const image of samples) {
      for (const { color, pixel } of image) {
        const fill =
          GROUP_PALETTE[mode][color as keyof typeof GROUP_PALETTE.light].fill
        expect(pixel).toEqual([
          ...fill
            .slice(1)
            .match(/../g)!
            .map((c) => parseInt(c, 16)),
          255,
        ])
      }
    }
  })
}
