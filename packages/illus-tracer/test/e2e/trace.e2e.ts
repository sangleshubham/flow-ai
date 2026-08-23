import { expect, test } from '@playwright/test'
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.traceHarness)
})
test('locked-down browser worker runs, denies network and restores after a hard timeout', async ({
  page,
}) => {
  const external: string[] = []
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost:5277')) external.push(r.url())
  })
  const good = await page.evaluate(() =>
    window.traceHarness.run('def f():\n  return 42', 'f()', ['f']),
  )
  expect(good.steps.at(-1)?.returnValue).toEqual({ prim: 42 })
  const blocked = await page.evaluate(() =>
    window.traceHarness.run(
      'import js\njs.fetch("https://example.invalid")',
      '0',
    ),
  )
  expect(blocked.error).toContain('not allowed')
  const indirect = await page.evaluate(() =>
    window.traceHarness.run(
      'import typing\ntyping.sys.modules["os"].system("echo escape")',
      '0',
    ),
  )
  expect(indirect.error).toContain('not allowed')
  const start = Date.now()
  const timeout = await page.evaluate(() =>
    window.traceHarness.run(
      'def f():\n  return sum(range(10000000000))',
      'f()',
      ['f'],
    ),
  )
  expect(timeout.error).toBe('timeout')
  expect(Date.now() - start).toBeLessThan(6000)
  const after = await page.evaluate(() =>
    window.traceHarness.run('def f():\n  return 7', 'f()', ['f']),
  )
  expect(after.steps.at(-1)?.returnValue).toEqual({ prim: 7 })
  expect(external).toEqual([])
})
test('renders actual fixture trace, structures, original highlights, scenarios and controls', async ({
  page,
}) => {
  await page.evaluate(() => window.traceHarness.render())
  await expect(page.getByText('executed', { exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Found' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByText('Step 1 of', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Next step' }).click()
  await expect(page.locator('[data-current="true"]')).toHaveCount(1)
  await expect(page.getByRole('img', { name: 'a', exact: true })).toBeVisible()
  await expect(page.getByLabel('Call stack')).toContainText('search')
  await expect(
    page.getByLabel('Original code').locator('span[style*="color"]').first(),
  ).toBeVisible()
  await page.getByText('Assumptions', { exact: true }).click()
  await expect(
    page.getByText('Go fixed-width integer overflow is not modelled.'),
  ).toBeVisible()
  await page.getByLabel('Show Python').check()
  await expect(page.getByLabel('Python code')).toBeVisible()
  await page.getByRole('tab', { name: 'Missing' }).click()
  await expect(page.getByRole('tab', { name: 'Missing' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page
    .getByRole('slider', { name: 'Animation step' })
    .fill(
      (await page
        .getByRole('slider', { name: 'Animation step' })
        .getAttribute('max')) ?? '0',
    )
  await expect(page.getByLabel('Return value')).toHaveText('Returns -1')
  await page.screenshot({ path: 'test-results/trace-view.png', fullPage: true })
})
