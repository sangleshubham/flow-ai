// Visual baselines for every template (light and dark) and template frames; evidence hover on templates.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { TEMPLATE_VISUALS } from './fixtures.ts'

async function open(page: Page, fixture: string, theme: 'light' | 'dark') {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`/index.html#${fixture}:${theme}`)
  await expect(page.locator('.illus-view')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(150)
  return { errors, view: page.locator('.illus-view') }
}

for (const theme of ['light', 'dark'] as const) {
  for (const name of TEMPLATE_VISUALS) {
    test(`${name} (${theme})`, async ({ page }) => {
      const { errors, view } = await open(page, name, theme)
      await expect(view.locator('.illus-note')).toHaveCount(0)
      await expect(view.locator('svg[data-illus-frame="self"]')).toHaveCount(1)
      await expect(view).toHaveScreenshot(`${name}-${theme}.png`)
      expect(errors).toEqual([])
      expect(await page.evaluate(() => window.__csp)).toEqual([])
    })
  }
}

test('hovering a template element reports its evidence', async ({ page }) => {
  await open(page, 'array', 'light')
  await page.locator('[data-target="cell:values[2]"]').hover()
  const events = await page.evaluate(() => window.__events)
  expect(events.at(-1)?.e).toMatchObject({ irId: 'values', target: 'item:values', evidence: { blockId: 'b-search-2' } })
})
