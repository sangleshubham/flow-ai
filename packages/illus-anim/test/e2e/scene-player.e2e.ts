import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const body = (page: Page, target: string) =>
  page.locator(`[data-target="${target}"] > [data-anim-body]`)
const next = (page: Page) => page.getByLabel('Next step').click()
const previous = (page: Page) => page.getByLabel('Previous step').click()
const restart = (page: Page) =>
  page.getByRole('button', { name: 'Restart', exact: true }).click()
const scrub = (page: Page, step: number) =>
  page.getByLabel('Animation step').fill(String(step))
const setSpeed = (page: Page, speed: number) =>
  page.getByLabel('Playback speed').selectOption(String(speed))
/** Everything the scenes are about: the bodies of nodes b…e (a is visible throughout). */
async function opacities(page: Page) {
  const read = (id: string) =>
    body(page, `node:${id}`).evaluate((el) =>
      Number(getComputedStyle(el).opacity),
    )
  return Object.fromEntries(
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map(async (id) => [id, await read(id)]),
    ),
  )
}
/** Outer node `<g>`s: React renders their `transform`, so GSAP must never touch it. */
const nodePositions = (page: Page) =>
  page
    .locator('.illus-node')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('transform')))
const cameraScale = (page: Page) =>
  page
    .locator('[data-camera]')
    .evaluate((el) =>
      Number(el.getAttribute('transform')!.match(/scale\(([^)]+)\)/)![1]),
    )

async function open(page: Page, query = '') {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(`/?kind=scene-player${query}`)
  await expect(page.getByRole('region')).toHaveAttribute(
    'data-scene-ready',
    'true',
  )
  return errors
}
/** Click Next and wait until the master timeline's playhead reaches `s1`; returns the elapsed milliseconds. */
const timeNextStep = (page: Page) =>
  page.evaluate(async () => {
    const tl = window.__sceneTimeline!()!
    const target = tl.labels.s1!
    const start = performance.now()
    ;(
      document.querySelector('[aria-label="Next step"]') as HTMLButtonElement
    ).click()
    await new Promise<void>((resolve) => {
      const tick = () =>
        tl.time() >= target - 1e-3 ? resolve() : requestAnimationFrame(tick)
      tick()
    })
    return {
      elapsed: performance.now() - start,
      planned: (target - tl.labels.s0!) * 1000,
    }
  })

test('Next, Previous, Restart and the slider land on the right scenes', async ({
  page,
}) => {
  const errors = await open(page)
  await setSpeed(page, 2)
  const positions = await nodePositions(page)
  expect(positions.length).toBe(5)
  // Scene 0: only A, zoomed in.
  expect(await opacities(page)).toEqual({ a: 1, b: 0, c: 0, d: 0, e: 0 })
  expect(await cameraScale(page)).toBeGreaterThan(1.2)
  await next(page)
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '1')
  await expect(page.locator('html')).toHaveAttribute('data-step', '1')
  expect(await opacities(page)).toEqual({ a: 1, b: 1, c: 0, d: 0, e: 0 })
  await next(page)
  await expect(body(page, 'node:e')).toHaveCSS('opacity', '1')
  expect(await opacities(page)).toEqual({ a: 1, b: 1, c: 1, d: 1, e: 1 })
  await expect.poll(() => cameraScale(page)).toBeCloseTo(1)
  // Jumps are immediate.
  await previous(page)
  expect(await opacities(page)).toEqual({ a: 1, b: 1, c: 0, d: 0, e: 0 })
  await restart(page)
  await expect(page.locator('html')).toHaveAttribute('data-step', '0')
  expect(await opacities(page)).toEqual({ a: 1, b: 0, c: 0, d: 0, e: 0 })
  expect(await cameraScale(page)).toBeGreaterThan(1.2)
  await scrub(page, 2)
  expect(await opacities(page)).toEqual({ a: 1, b: 1, c: 1, d: 1, e: 1 })
  expect(await cameraScale(page)).toBeCloseTo(1)
  await scrub(page, 1)
  expect(await opacities(page)).toEqual({ a: 1, b: 1, c: 0, d: 0, e: 0 })
  await scrub(page, 0)
  expect(await opacities(page)).toEqual({ a: 1, b: 0, c: 0, d: 0, e: 0 })
  expect(await nodePositions(page)).toEqual(positions)
  expect(errors).toEqual([])
})

test('the keyboard drives the player: arrows, Home and Space', async ({
  page,
}) => {
  const errors = await open(page)
  await setSpeed(page, 2)
  const player = page.getByRole('region', { name: 'Animation player' })
  await player.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('html')).toHaveAttribute('data-step', '1')
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '1')
  await page.keyboard.press('Home')
  await expect(page.locator('html')).toHaveAttribute('data-step', '0')
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '0')
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-step', '1', {
    timeout: 5000,
  })
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '1')
  expect(errors).toEqual([])
})

test('a step takes about half as long at 2x as at 1x, and as planned at 1x', async ({
  page,
}) => {
  const errors = await open(page)
  const one = await timeNextStep(page)
  expect(one.planned).toBeGreaterThan(500)
  expect(one.elapsed).toBeGreaterThan(one.planned * 0.65)
  expect(one.elapsed).toBeLessThan(one.planned * 1.35)
  await restart(page)
  await setSpeed(page, 2)
  const two = await timeNextStep(page)
  expect(two.planned).toBe(one.planned)
  expect(two.elapsed / one.elapsed).toBeGreaterThan(0.5 * 0.65)
  expect(two.elapsed / one.elapsed).toBeLessThan(0.5 * 1.35)
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '1')
  expect(errors).toEqual([])
})

for (const how of ['the motion setting', 'the system preference'] as const) {
  test(`reduced motion (${how}) jumps without tweening`, async ({ page }) => {
    if (how === 'the system preference')
      await page.emulateMedia({ reducedMotion: 'reduce' })
    const errors = await open(
      page,
      how === 'the motion setting' ? '&motion=on' : '',
    )
    await expect(page.getByRole('region')).toHaveAttribute(
      'data-reduced-motion',
      'true',
    )
    const jumped = await page.evaluate(async () => {
      const read = () =>
        Number(
          getComputedStyle(
            document.querySelector(
              '[data-target="node:b"] > [data-anim-body]',
            )!,
          ).opacity,
        )
      const tl = window.__sceneTimeline!()!
      const start = performance.now()
      ;(
        document.querySelector('[aria-label="Next step"]') as HTMLButtonElement
      ).click()
      while (read() !== 1 && performance.now() - start < 2000)
        await new Promise((resolve) => requestAnimationFrame(resolve))
      return {
        elapsed: performance.now() - start,
        playheadTweens: window.__sceneRunning!(),
        time: tl.time(),
        target: tl.labels.s1!,
      }
    })
    expect(jumped.elapsed).toBeLessThan(50)
    expect(jumped.playheadTweens).toBe(0)
    expect(jumped.time).toBeCloseTo(jumped.target)
    // A second jump is just as immediate: no waiting, no retrying.
    await next(page)
    expect(await opacities(page)).toEqual({ a: 1, b: 1, c: 1, d: 1, e: 1 })
    expect(await cameraScale(page)).toBeCloseTo(1)
    expect(errors).toEqual([])
  })
}

test('with motion on, the same step is not instant', async ({ page }) => {
  await open(page, '&motion=off')
  const early = await page.evaluate(async () => {
    ;(
      document.querySelector('[aria-label="Next step"]') as HTMLButtonElement
    ).click()
    await new Promise((resolve) => setTimeout(resolve, 50))
    return Number(
      getComputedStyle(
        document.querySelector('[data-target="node:b"] > [data-anim-body]')!,
      ).opacity,
    )
  })
  expect(early).toBeLessThan(1)
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '1')
})

test('outer node transforms never change, while playing, after it, or after any jump', async ({
  page,
}) => {
  const errors = await open(page)
  const positions = await nodePositions(page)
  await next(page)
  // Mid-step: the node is fading in and scaling, the camera is moving.
  await page.waitForTimeout(350)
  expect(await nodePositions(page)).toEqual(positions)
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '1')
  await page.waitForTimeout(700)
  expect(await nodePositions(page)).toEqual(positions)
  await next(page)
  await page.waitForTimeout(500)
  expect(await nodePositions(page)).toEqual(positions)
  await expect(body(page, 'node:e')).toHaveCSS('opacity', '1')
  expect(await nodePositions(page)).toEqual(positions)
  for (const jump of [() => previous(page), () => restart(page)]) {
    await jump()
    expect(await nodePositions(page)).toEqual(positions)
  }
  await scrub(page, 2)
  expect(await nodePositions(page)).toEqual(positions)
  expect(errors).toEqual([])
})

test('the Highlight checkbox and the narration report to the host', async ({
  page,
}) => {
  const errors = await open(page)
  await setSpeed(page, 2)
  const log = () => page.evaluate(() => window.__sceneLog!)
  const quote = 'Compare adjacent values and swap them into ascending order.'
  // On by default; the base frame has no passage.
  const box = page.getByLabel('Highlight passage while playing')
  await expect(box).toBeChecked()
  expect((await log()).highlights.at(-1)).toBeNull()
  await next(page)
  expect((await log()).highlights.at(-1)).toBe(quote)
  await box.uncheck()
  expect((await log()).highlights.at(-1)).toBeNull()
  await next(page)
  expect((await log()).highlights.at(-1)).toBeNull()
  await box.check()
  expect((await log()).highlights.at(-1)).toBe(quote)
  await page.getByRole('button', { name: 'Show the rest.' }).click()
  expect((await log()).clicks).toEqual([quote])
  await restart(page)
  expect((await log()).highlights.at(-1)).toBeNull()
  expect(errors).toEqual([])
})

test('autoplay runs once to the full picture, and never with reduced motion', async ({
  page,
}) => {
  const errors = await open(page, '&autoplay=on')
  await setSpeed(page, 2)
  await expect(page.locator('html')).toHaveAttribute('data-step', '2', {
    timeout: 15_000,
  })
  await expect(body(page, 'node:e')).toHaveCSS('opacity', '1')
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await expect.poll(() => cameraScale(page)).toBeCloseTo(1)
  expect(errors).toEqual([])
  const reduced = await page.context().newPage()
  await reduced.goto('/?kind=scene-player&autoplay=on&motion=on')
  await expect(reduced.getByRole('region')).toHaveAttribute(
    'data-scene-ready',
    'true',
  )
  await reduced.waitForTimeout(2500)
  await expect(reduced.locator('html')).toHaveAttribute('data-step', '0')
  await expect(reduced.getByRole('button', { name: 'Play' })).toBeVisible()
})

test('survives React StrictMode: the revert-and-rebuild leaves one working timeline', async ({
  page,
}) => {
  const errors = await open(page, '&strict=on')
  await setSpeed(page, 2)
  const positions = await nodePositions(page)
  expect(await opacities(page)).toEqual({ a: 1, b: 0, c: 0, d: 0, e: 0 })
  expect(await cameraScale(page)).toBeGreaterThan(1.2)
  await next(page)
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '1')
  await restart(page)
  expect(await opacities(page)).toEqual({ a: 1, b: 0, c: 0, d: 0, e: 0 })
  await scrub(page, 2)
  expect(await opacities(page)).toEqual({ a: 1, b: 1, c: 1, d: 1, e: 1 })
  await restart(page)
  expect(await opacities(page)).toEqual({ a: 1, b: 0, c: 0, d: 0, e: 0 })
  expect(await nodePositions(page)).toEqual(positions)
  expect(errors).toEqual([])
})

test('new frames revert the old timeline, rebuild, and start again at scene 0', async ({
  page,
}) => {
  const errors = await open(page, '&swap=on')
  await setSpeed(page, 2)
  const positions = await nodePositions(page)
  await scrub(page, 2)
  expect(await opacities(page)).toEqual({ a: 1, b: 1, c: 1, d: 1, e: 1 })
  expect(await cameraScale(page)).toBeCloseTo(1)
  await page.getByRole('button', { name: 'Swap frames' }).click()
  await expect(page.getByRole('region')).toHaveAttribute(
    'data-scene-ready',
    'true',
  )
  await expect(page.locator('html')).toHaveAttribute('data-step', '0')
  expect(await opacities(page)).toEqual({ a: 1, b: 0, c: 0, d: 0, e: 0 })
  expect(await cameraScale(page)).toBeGreaterThan(1.2)
  await next(page)
  await expect(body(page, 'node:b')).toHaveCSS('opacity', '1')
  expect(await nodePositions(page)).toEqual(positions)
  expect(errors).toEqual([])
})
