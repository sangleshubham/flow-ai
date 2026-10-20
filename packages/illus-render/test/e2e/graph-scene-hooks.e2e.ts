import { expect, test } from '@playwright/test'

import { GROUP_PALETTE } from '../../src/graph/palette.ts'
import { open } from './helpers.ts'

function rgb(hex: string): string {
  return `rgb(${hex
    .slice(1)
    .match(/../g)!
    .map((c) => parseInt(c, 16))
    .join(', ')})`
}

test('graph bodies keep edge paths addressable and layout transforms on outer nodes', async ({
  page,
}) => {
  await open(page, 'graph-shapes')
  const svg = page.locator('svg.illus-graph')
  const camera = svg.locator(':scope > [data-camera]')
  await expect(camera).toHaveCount(1)
  expect(await camera.getAttribute('transform')).toBeNull()
  const layout = (await svg.getAttribute('data-layout'))!.split(' ').map(Number)
  expect(layout).toHaveLength(2)
  expect(layout.every((n) => n > 0)).toBe(true)
  const targets = camera.locator('[data-target]')
  for (const target of await targets.all()) {
    await expect(target.locator(':scope > [data-anim-body]')).toHaveCount(1)
    const id = (await target.getAttribute('data-target'))!
    if (id.startsWith('edge:')) {
      expect(
        await target.evaluate((el) =>
          el.querySelector('path,line')?.classList.contains('illus-edge-line'),
        ),
      ).toBe(true)
    } else {
      const box = (await target.getAttribute('data-box'))!
        .split(' ')
        .map(Number)
      expect(box).toHaveLength(4)
      expect(box.every(Number.isFinite)).toBe(true)
      expect(box[2]).toBeGreaterThan(0)
      expect(box[3]).toBeGreaterThan(0)
      if (id.startsWith('node:'))
        await expect(target).toHaveAttribute('transform', /^translate\(/)
    }
  }
  const overlay = camera.locator(':scope > [data-scene-overlay]:last-child')
  await expect(overlay).toHaveCount(1)
  expect(await overlay.evaluate((el) => el.childElementCount)).toBe(0)
})

test('scene data tones match frame classes, including focus table cells', async ({
  page,
}) => {
  await open(page, 'graph-shapes')
  const styles = await page.evaluate(() => {
    const node = document.querySelector('[data-target="node:leader"]')!
    const body = node.querySelector('[data-anim-body]')!
    const shape = body.querySelector('.illus-shape')!
    // A muted scene tone dims the outer <g> (GSAP owns the body's inline opacity), so compare the
    // opacity the reader sees. The outer <g> eases opacity over 0.2 s; read it settled.
    ;(node as SVGElement).style.transition = 'none'
    const read = () => {
      const s = getComputedStyle(shape)
      return [
        s.fill,
        s.stroke,
        s.strokeWidth,
        s.strokeDasharray,
        Number(getComputedStyle(body).opacity) *
          Number(getComputedStyle(node).opacity),
      ]
    }
    const tones = ['focus', 'success', 'warning', 'muted'].map((tone) => {
      body.classList.add(`illus-tone-${tone}`)
      const frame = read()
      body.classList.remove(`illus-tone-${tone}`)
      body.setAttribute('data-tone', tone)
      const scene = read()
      body.removeAttribute('data-tone')
      return { tone, frame, scene }
    })
    const table = document.createElement('table')
    table.innerHTML = '<tbody><tr><td>cell</td></tr></tbody>'
    document.querySelector('.illus-view')!.append(table)
    const cell = table.querySelector('td')!
    const row = table.querySelector('tr')!
    const background = () => getComputedStyle(cell).backgroundColor
    cell.className = 'illus-tone-focus'
    const cellClass = background()
    cell.className = ''
    cell.dataset.tone = 'focus'
    const cellData = background()
    delete cell.dataset.tone
    row.className = 'illus-tone-focus'
    const rowClass = background()
    row.className = ''
    row.dataset.tone = 'focus'
    const rowData = background()
    table.remove()
    return { tones, cellClass, cellData, rowClass, rowData }
  })
  for (const { tone, frame, scene } of styles.tones)
    expect(scene, tone).toEqual(frame)
  expect(styles.cellData).toBe(styles.cellClass)
  expect(styles.rowData).toBe(styles.rowClass)
  expect(styles.cellData).not.toBe('rgba(0, 0, 0, 0)')
})

test('body wrappers preserve node and group accent colours', async ({
  page,
}) => {
  await open(page, 'graph-shapes')
  const colours = await page.evaluate(() => {
    const node = document.querySelector('[data-target="node:leader"]')!
    const group = document.querySelector('[data-target="group:srv"]')!
    node.setAttribute('data-color', 'green')
    group.setAttribute('data-color', 'blue')
    return {
      node: getComputedStyle(node.querySelector('.illus-shape')!).stroke,
      group: getComputedStyle(group.querySelector('.illus-group-box')!).stroke,
      label: getComputedStyle(group.querySelector('.illus-group-label')!).fill,
    }
  })
  expect(colours).toEqual({
    node: rgb(GROUP_PALETTE.light.green.ink),
    group: rgb(GROUP_PALETTE.light.blue.ink),
    label: rgb(GROUP_PALETTE.light.blue.ink),
  })
})
