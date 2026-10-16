import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const body = (page: Page, target: string) =>
  page.locator(`[data-target="${target}"] > [data-anim-body]`)
const annotation = (page: Page, text: string) =>
  page.locator('[data-annotation-target]').filter({ hasText: text })
const seek = (page: Page, position: string | number) =>
  page.evaluate((to) => {
    // Return nothing: Timeline#seek returns the (cyclic) timeline, which Playwright cannot serialise.
    window.__scene!.tl.seek(to)
  }, position)
const cameraScale = (page: Page) =>
  page
    .locator('[data-camera]')
    .evaluate((el) =>
      Number(el.getAttribute('transform')!.match(/scale\(([^)]+)\)/)![1]),
    )
/** Outer node `<g>`s: React renders their `transform`, so GSAP must never touch it. */
const nodePositions = (page: Page) =>
  page
    .locator('.illus-node')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('transform')))
/** Everything a seek is meant to restore, as plain data. */
const picture = (page: Page) =>
  page.evaluate(() => {
    const opacity = (el: Element) => Number(getComputedStyle(el).opacity)
    return {
      camera: document
        .querySelector('[data-camera]')!
        .getAttribute('transform'),
      bodies: Object.fromEntries(
        [...document.querySelectorAll('[data-target] > [data-anim-body]')].map(
          (el) => [
            el.parentElement!.getAttribute('data-target')!,
            [opacity(el), el.getAttribute('data-tone')],
          ],
        ),
      ),
      overlay: [...document.querySelectorAll('[data-scene-overlay] > *')].map(
        opacity,
      ),
    }
  })
async function open(page: Page, kind: 'scene' | 'scene-details') {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(`/?kind=${kind}`)
  await page.waitForFunction(() => !!window.__scene)
  return errors
}

test('seeking restores each scene: states, camera, drawn edges, outer node positions', async ({
  page,
}) => {
  const errors = await open(page, 'scene')
  const positions = await nodePositions(page)
  expect(positions.length).toBeGreaterThan(3)
  const edge = body(page, 'edge:ab')
  const line = edge.locator('.illus-edge-line')
  // DrawSVG animates the dash array; the offset only matters once the line is complete.
  const dashOffset = () =>
    line.evaluate(
      (el) => parseFloat(getComputedStyle(el).strokeDashoffset) || 0,
    )
  const drawnLength = () =>
    line.evaluate((el) => ({
      dash: parseFloat(getComputedStyle(el).strokeDasharray),
      total: (el as unknown as SVGPathElement).getTotalLength(),
    }))

  // Straight after the build, before any seek: the timeline has already applied scene 0.
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '0')
  await expect(body(page, 'node:a')).toHaveCSS('opacity', '1')

  await seek(page, 's0')
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '0')
  await expect(edge).toHaveCSS('opacity', '0')
  expect(await cameraScale(page)).toBeGreaterThan(1.2)
  expect(await nodePositions(page)).toEqual(positions)

  await seek(page, 's1')
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '1')
  await expect(edge).toHaveCSS('opacity', '1')
  expect(await dashOffset()).toBeCloseTo(0)
  const full = await drawnLength()
  expect(full.dash).toBeGreaterThanOrEqual(full.total - 1)
  await expect(edge.locator('.illus-edge-head')).toHaveCSS('opacity', '1')
  await expect(edge.locator('.illus-edge-label')).toHaveCSS('opacity', '1')
  await expect(body(page, 'node:c')).toHaveCSS('opacity', '0')
  expect(await nodePositions(page)).toEqual(positions)

  // Half way through the stroke: partly drawn, the head and label still waiting.
  const drawTween = await page.evaluate(
    () =>
      window.__scene!.plan.steps[0]!.tweens.find(
        (tween) => tween.kind === 'draw' && tween.target === 'edge:ab',
      )!,
  )
  if (drawTween.kind !== 'draw') throw new Error('Expected a draw tween')
  await seek(page, drawTween.at + drawTween.duration / 2)
  const half = await drawnLength()
  expect(half.dash).toBeGreaterThan(full.total * 0.2)
  expect(half.dash).toBeLessThan(full.total * 0.8)
  await expect(edge.locator('.illus-edge-head')).toHaveCSS('opacity', '0')

  await seek(page, 's2')
  expect(await cameraScale(page)).toBeCloseTo(1)
  for (const id of ['a', 'b', 'c', 'd', 'e'])
    await expect(body(page, `node:${id}`)).toHaveCSS('opacity', '1')
  expect(await nodePositions(page)).toEqual(positions)

  await seek(page, 's0')
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '0')
  await expect(edge).toHaveCSS('opacity', '0')
  expect(await cameraScale(page)).toBeGreaterThan(1.2)
  expect(await nodePositions(page)).toEqual(positions)
  expect(errors).toEqual([])
})

test('a jump lands on the same picture as playing through to it', async ({
  page,
}) => {
  const errors = await open(page, 'scene-details')
  const labels = await page.evaluate(() =>
    Object.keys(window.__scene!.tl.labels),
  )
  expect(labels).toEqual(['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'])
  const forward: Awaited<ReturnType<typeof picture>>[] = []
  for (const label of labels) {
    await seek(page, label)
    forward.push(await picture(page))
  }
  for (const index of [7, 2, 5, 0, 3, 6, 1, 4, 7, 0]) {
    await seek(page, labels[index]!)
    expect(await picture(page), labels[index]).toEqual(forward[index])
  }
  expect(errors).toEqual([])
})

test('seeks restore tones, annotation replacement, and visible, faded and hidden states', async ({
  page,
}) => {
  await open(page, 'scene-details')
  await seek(page, 's1')
  await expect(body(page, 'node:b')).toHaveAttribute('data-tone', 'focus')
  await expect(annotation(page, 'first')).toHaveCSS('opacity', '1')
  await seek(page, 's2')
  await expect(body(page, 'node:b')).toHaveAttribute('data-tone', 'success')
  await expect(annotation(page, 'first')).toHaveCSS('opacity', '0')
  await expect(annotation(page, 'second')).toHaveCSS('opacity', '1')
  // Step 3 switches the tone off at its very start; seeking to s2 must not apply that early.
  await seek(page, 's3')
  await expect(body(page, 'node:b')).toHaveAttribute('data-tone', 'none')
  await expect(annotation(page, 'second')).toHaveCSS('opacity', '0')
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '0.15')
  await expect(body(page, 'edge:ab')).toHaveCSS('opacity', '0.15')
  await seek(page, 's4')
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '0')
  await seek(page, 's5')
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '1')
  await seek(page, 's3')
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '0.15')
  // Faded, then straight back to full: no dip to zero, and seeking back restores the faded picture.
  await seek(page, 's6')
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '0.15')
  const reveal = await page.evaluate(
    () =>
      window.__scene!.plan.steps[6]!.tweens.find(
        (tween) => tween.kind === 'show' && tween.target === 'node:b',
      )!,
  )
  await seek(page, reveal.at + 0.001)
  expect(
    Number(
      await body(page, 'node:b').evaluate((el) => getComputedStyle(el).opacity),
    ),
  ).toBeGreaterThanOrEqual(0.15)
  await seek(page, 's7')
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '1')
  await seek(page, 's6')
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '0.15')
  await seek(page, 's1')
  await expect(body(page, 'node:b')).toHaveAttribute('data-tone', 'focus')
  await expect(annotation(page, 'first')).toHaveCSS('opacity', '1')
  await expect(annotation(page, 'second')).toHaveCSS('opacity', '0')
  await seek(page, 's0')
  await expect(body(page, 'node:b')).toHaveAttribute('data-tone', 'none')
  await expect(annotation(page, 'first')).toHaveCSS('opacity', '0')
})

test('tokens and their labels follow the edge paths, expire, and seek backwards', async ({
  page,
}) => {
  await open(page, 'scene-details')
  const token = await page.evaluate(
    () =>
      window.__scene!.plan.steps[1]!.tweens.find(
        (tween) => tween.kind === 'token',
      )!,
  )
  if (token.kind !== 'token') throw new Error('Expected token choreography')
  const dot = page.locator('[data-scene-token]')
  const label = page.locator('[data-scene-token-label]')
  const centre = () =>
    dot.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
  // Painted with the theme tokens (unstyled SVG shapes and text would be black).
  await expect(dot).toHaveCSS('fill', 'rgb(14, 165, 233)')
  await expect(label).toHaveCSS('fill', 'rgb(31, 35, 40)')
  await seek(page, token.at - 0.01)
  await expect(dot).toHaveCSS('opacity', '0')
  await seek(page, token.at + 0.05)
  await expect(dot).toHaveCSS('opacity', '1')
  await expect(label).toHaveCSS('opacity', '1')
  const start = await centre()
  // The label rides above its dot instead of on top of it.
  const labelBox = await label.boundingBox()
  expect(labelBox!.y + labelBox!.height).toBeLessThan(start.y)
  await seek(page, token.at + 0.65)
  expect((await centre()).x).toBeGreaterThan(start.x + 50)
  await seek(page, token.at + token.duration - 0.001)
  const end = await centre()
  const pathEnd = await body(page, 'edge:bc')
    .locator('.illus-edge-line')
    .evaluate((el) => {
      const path = el as SVGPathElement
      const p = path.getPointAtLength(path.getTotalLength())
      const screen = new DOMPoint(p.x, p.y).matrixTransform(
        path.getScreenCTM()!,
      )
      return { x: screen.x, y: screen.y }
    })
  expect(Math.hypot(end.x - pathEnd.x, end.y - pathEnd.y)).toBeLessThan(3)
  await seek(page, 's2')
  await expect(dot).toHaveCSS('opacity', '0')
  await expect(label).toHaveCSS('opacity', '0')
  await seek(page, token.at + 0.05)
  await expect(dot).toHaveCSS('opacity', '1')
  expect((await centre()).x).toBeCloseTo(start.x, 0)
})

test('reverting the context removes the overlay and restores the static graph and camera', async ({
  page,
}) => {
  await open(page, 'scene-details')
  const staticMarkup = await page.evaluate(() => window.__scene!.staticMarkup)
  const positions = await nodePositions(page)
  await seek(page, 's3')
  await page.evaluate(() => window.__scene!.ctx.revert())
  await expect(page.locator('[data-camera]')).not.toHaveAttribute('transform')
  await expect(page.locator('[data-scene-overlay] > *')).toHaveCount(0)
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '1')
  expect(await nodePositions(page)).toEqual(positions)
  // GSAP renders lazily on the next tick; make sure nothing re-applies after the revert.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '1')
  // The markup React rendered, apart from the empty `style` attributes GSAP's own revert leaves.
  const blankStyles = (markup: string) => markup.replaceAll(' style=""', '')
  expect(
    blankStyles(
      await page.evaluate(
        () => document.querySelector('[data-camera]')!.innerHTML,
      ),
    ),
  ).toBe(blankStyles(staticMarkup))
})
