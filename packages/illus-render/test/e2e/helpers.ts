import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/** Opens a harness fixture and waits until its renderer reports ready. */
export async function open(page: Page, fixture: string, theme: 'light' | 'dark' = 'light') {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`/index.html#${fixture}:${theme}`)
  await expect(page.locator('.illus-view')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
  // Let layout effects (fit, overlay) settle.
  await page.waitForTimeout(150)
  return { errors, view: page.locator('.illus-view') }
}
