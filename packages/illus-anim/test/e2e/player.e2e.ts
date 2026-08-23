import { test, expect } from '@playwright/test'

for (const kind of ['array', 'sequence']) {
  test(`${kind} golden plays pauses steps scrubs and restarts without frame errors`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`/?kind=${kind}`)
    await expect(page.locator('svg').first()).toBeVisible()
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-step', '1', {
      timeout: 6000,
    })
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await page.getByLabel('Next step').click()
    await expect(page.locator('html')).toHaveAttribute('data-step', '2')
    await page.getByLabel('Animation step').fill('0')
    await expect(page.locator('html')).toHaveAttribute('data-step', '0')
    await page.getByLabel('Animation step').fill(kind === 'array' ? '3' : '2')
    await page.getByRole('button', { name: 'Restart', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-step', '0')
    const player = page.getByRole('region', { name: 'Animation player' })
    await player.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('html')).toHaveAttribute('data-step', '1')
    await page.keyboard.press('Home')
    await expect(page.locator('html')).toHaveAttribute('data-step', '0')
    expect(errors).toEqual([])
  })
  test(`${kind} reduced motion switches frames with no active tweens`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/?kind=${kind}`)
    await expect(page.locator('svg').first()).toBeVisible()
    await expect(page.getByRole('region')).toHaveAttribute(
      'data-reduced-motion',
      'true',
    )
    await page.getByLabel('Animation step').fill('2')
    await expect(page.locator('html')).toHaveAttribute('data-step', '2')
    expect(
      await page
        .locator('svg')
        .first()
        .evaluate(
          (svg) =>
            svg
              .getAnimations({ subtree: true })
              .filter((a) => a.playState === 'running').length,
        ),
    ).toBe(0)
  })
}
for (const setting of ['system', 'off']) {
  test(`token follows real graph edge paths and expires (${setting} motion setting)`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    if (setting === 'off') await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/?kind=graph&motion=${setting}`)
    await expect(page.getByRole('region')).toHaveAttribute(
      'data-reduced-motion',
      'false',
    )
    await expect(page.locator('[data-target="edge:e"]')).toBeVisible()
    await page.getByLabel('Next step').click()
    const token = page.locator('[data-token-id="t"]')
    await expect(token).toBeVisible()
    const initial = await token.evaluate((el) =>
      parseFloat((el as HTMLElement).style.left),
    )
    await expect
      .poll(() =>
        token.evaluate((el) => parseFloat((el as HTMLElement).style.left)),
      )
      .toBeGreaterThan(initial + 10)
    await page.getByLabel('Next step').click()
    await expect(token).toHaveCount(0)
    expect(errors).toEqual([])
  })
}
test('configured reduced motion overrides OS and token goes immediately to endpoint', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/?kind=graph&motion=on')
  await expect(page.getByRole('region')).toHaveAttribute(
    'data-reduced-motion',
    'true',
  )
  await expect(page.locator('[data-target="edge:e"]')).toBeVisible()
  await page.getByLabel('Next step').click()
  await expect(page.locator('[data-token-id="t"]')).toBeVisible()
  const distance = await page.evaluate(() => {
    const path = document.querySelector<SVGPathElement>(
      '[data-target="edge:e"] path',
    )!
    const point = path.getPointAtLength(path.getTotalLength()),
      end = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!)
    const token = document.querySelector<HTMLElement>('[data-token-id="t"]')!,
      parent = token.parentElement!.getBoundingClientRect()
    return (
      Math.abs(parent.left + parseFloat(token.style.left) - end.x) +
      Math.abs(parent.top + parseFloat(token.style.top) - end.y)
    )
  })
  expect(distance).toBeLessThan(2)
})
