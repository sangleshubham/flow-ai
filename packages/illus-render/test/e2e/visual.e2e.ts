// Visual-regression baselines for every renderer, light and dark (§18).
import { expect, test } from '@playwright/test'

import { VISUAL_FIXTURES } from '../harness/fixtures.ts'

import { open } from './helpers.ts'

for (const theme of ['light', 'dark'] as const) {
  for (const name of VISUAL_FIXTURES) {
    test(`${name} (${theme})`, async ({ page }) => {
      const { errors, view } = await open(page, name, theme)
      if (name === 'html') await expect(page.frameLocator('iframe').locator('h3')).toHaveText('Log replication')
      await expect(view).toHaveScreenshot(`${name}-${theme}.png`)
      expect(errors).toEqual([])
      expect(await page.evaluate(() => window.__csp)).toEqual([])
    })
  }
}
