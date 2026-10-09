// Evidence ids and callbacks, frames, theme change, pan/zoom, export and the layout worker (§10, §11).
import { expect, test } from '@playwright/test'

import { open } from './helpers.ts'

const KINDS = ['graph-shapes', 'sequence', 'state', 'class', 'er', 'chart', 'math', 'timeline']

for (const name of KINDS) {
  test(`${name}: every evidence element is rendered with data-ir-id and data-target`, async ({ page }) => {
    await open(page, name)
    const ids = await page.evaluate(() => window.__evidenceIds)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      const el = page.locator(`.illus-canvas [data-ir-id="${id}"]`).first()
      await expect(el, `element ${id}`).toBeAttached()
      await expect(el).toHaveAttribute('data-target', /^(node|edge|group|msg|item):/)
    }
  })
}

test('evidence callbacks fire on hover, click and keyboard', async ({ page }) => {
  await open(page, 'state')
  const node = page.locator('.illus-canvas [data-ir-id="candidate"]').first()
  await node.hover()
  await node.click()
  const events = await page.evaluate(() => window.__events.filter((e) => e.e))
  expect(events.map((e) => [e.type, e.e!.irId])).toEqual([
    ['hover', 'candidate'],
    ['click', 'candidate'],
  ])
  expect(events[1]!.e!.evidence.quote).toContain('becomes a candidate')
  expect(events[1]!.e!.target).toBe('node:candidate')

  await page.mouse.move(0, 0)
  await expect.poll(() => page.evaluate(() => window.__events.at(-1)!.e)).toBeNull()

  await page.locator('.illus-canvas [data-ir-id="t2"][tabindex]').first().focus()
  await page.keyboard.press('Enter')
  const last = await page.evaluate(() => window.__events.at(-1)!)
  expect([last.type, last.e!.irId]).toEqual(['click', 't2'])
})

test('graph edges and groups report their own evidence', async ({ page }) => {
  await open(page, 'graph-shapes')
  await page.locator('[data-ir-id="e2"] .illus-edge-line').dispatchEvent('click')
  await page.locator('[data-ir-id="srv"] text').click()
  const clicks = await page.evaluate(() => window.__events.filter((e) => e.type === 'click').map((e) => e.e!.irId))
  expect(clicks).toEqual(['e2', 'srv'])
})

test('frames: hidden, highlights, pointers, values, annotations and tokens', async ({ page }) => {
  await open(page, 'graph-frame')
  await expect(page.locator('[data-target="node:leader"]')).toHaveClass(/illus-tone-focus/)
  await expect(page.locator('[data-target="edge:e2"]')).toHaveClass(/illus-tone-success/)
  await expect(page.locator('[data-target="node:log"]')).toHaveClass(/illus-tone-warning/)
  await expect(page.locator('[data-pointer="head"]')).toHaveText(/head/)
  await expect(page.locator('[data-value-for="node:leader"]')).toHaveText('3')
  await expect(page.locator('[data-annotation-for="node:leader"]')).toHaveText('appends the command')
  await expect(page.locator('[data-token-id="cmd"]')).toHaveAttribute('data-token-path', 'e1,e2')
})

test('sequence frames toggle classes on message elements', async ({ page }) => {
  await open(page, 'sequence-frame')
  const m3 = page.locator('[data-target="msg:m3"]')
  await expect(m3).toHaveCount(2) // the line and its text
  for (const el of await m3.all()) await expect(el).toHaveClass(/illus-hidden/)
  await expect(page.locator('line[data-target="msg:m2"]')).toHaveClass(/illus-tone-focus/)
})

test('concept models mark new and earlier elements and show the legend', async ({ page }) => {
  await open(page, 'graph-concept')
  await expect(page.locator('[data-legend]')).toContainText('New in this section')
  await expect(page.locator('[data-target="node:follower"]')).toHaveClass(/illus-new/)
  await expect(page.locator('[data-target="node:leader"]')).toHaveClass(/illus-earlier/)
})

test('theme tokens follow Flow and update on theme change', async ({ page }) => {
  const { view } = await open(page, 'graph')
  const bg = () => view.evaluate((el) => getComputedStyle(el).getPropertyValue('--illus-bg'))
  expect(await bg()).toBe('rgb(251 252 255)')
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await expect(view).toHaveAttribute('data-theme', 'dark')
  expect(await bg()).toBe('rgb(25 28 30)')
})

test('pan and zoom: ctrl+wheel zooms, drag pans, double-click resets', async ({ page }) => {
  const { view } = await open(page, 'state')
  const canvas = view.locator('.illus-canvas')
  const start = await canvas.getAttribute('data-zoom')
  const box = (await view.locator('.illus-surface').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -200)
  await page.keyboard.up('Control')
  await expect.poll(() => canvas.getAttribute('data-zoom')).not.toBe(start)
  const before = await canvas.evaluate((el) => el.style.transform)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 10, { steps: 4 })
  await page.mouse.up()
  expect(await canvas.evaluate((el) => el.style.transform)).not.toBe(before)
  await view.locator('.illus-surface').dblclick({ position: { x: 5, y: 5 } })
  await expect.poll(() => canvas.getAttribute('data-zoom')).toBe(start)
})

test('footer actions call back', async ({ page }) => {
  const { view } = await open(page, 'graph')
  await view.getByRole('button', { name: 'Regenerate' }).click()
  await view.getByRole('button', { name: 'Helpful', exact: true }).click()
  await view.getByRole('combobox', { name: 'Draw as another kind' }).selectOption('sequence')
  await view.getByRole('button', { name: 'Evidence' }).click()
  expect(await page.evaluate(() => window.__actions)).toEqual(['regenerate', 'vote:up', 'kind:sequence', 'evidence'])
  await expect(view.getByRole('button', { name: 'Helpful', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

for (const name of ['graph-shapes', 'class', 'chart', 'timeline']) {
  test(`${name}: export SVG is standalone and PNG is drawn at 2x`, async ({ page }) => {
    await open(page, name)
    const svg = await page.evaluate(() => window.__exportSvg())
    expect(svg).toMatch(/^<svg[^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/)
    expect(svg).toContain('--illus-bg:')
    expect(svg).not.toMatch(/<script|onerror|onload/i)
    const width = Number(/width="(\d+)"/.exec(svg)![1])
    const png = await page.evaluate(() => window.__exportPng())
    expect(png.width).toBe(width * 2)
    expect(png.bytes).toBeGreaterThan(1000)
  })
}

test('layout runs in a dedicated worker and accepts position hints', async ({ page }) => {
  const workers: string[] = []
  page.on('worker', (w) => workers.push(w.url()))
  await open(page, 'graph')
  expect(workers.some((u) => u.includes('layout.worker'))).toBe(true)
  const res = await page.evaluate(async () => {
    const input = {
      algorithm: 'layered' as const,
      direction: 'TB' as const,
      nodes: [
        { id: 'a', width: 80, height: 40 },
        { id: 'b', width: 80, height: 40 },
      ],
      edges: [{ id: 'ab', from: 'a', to: 'b' }],
    }
    const first = await window.__layout(input)
    const hinted = await window.__layout({ ...input, hints: { a: { x: first.nodes.a!.x, y: first.nodes.a!.y } } })
    return { first, hinted }
  })
  expect(res.first.nodes.b!.y).toBeGreaterThan(res.first.nodes.a!.y)
  expect(res.first.edges.ab!.points.length).toBeGreaterThanOrEqual(2)
  expect(res.hinted.nodes.a).toEqual(res.first.nodes.a)
})

test('a missing template shows a note, never a blank', async ({ page }) => {
  await open(page, 'template')
  await expect(page.locator('.illus-note')).toContainText('array template is not available')
})

test('a disabled HTML fallback shows a note and no iframe', async ({ page }) => {
  await open(page, 'html-off')
  await expect(page.locator('.illus-note')).toContainText('htmlFallback')
  await expect(page.locator('iframe')).toHaveCount(0)
})
