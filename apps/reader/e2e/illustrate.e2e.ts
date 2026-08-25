import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { E2E_ENV, E2E_PORT, sessionValue } from './env'

const BOOK = join(__dirname, '../../../fixtures/books/synthetic.epub')
test('open book → navigate → visual → evidence highlights the quoted passage; keyboard pane controls', async ({ context, page }, testInfo) => {
  test.setTimeout(120_000)
  const requests: unknown[] = []
  page.on('request', (request) => { if (request.url().endsWith('/api/llm') && request.method() === 'POST') requests.push(request.postDataJSON()) })
  const errors: string[] = []
  page.on('pageerror', (error) => { errors.push(error.message); console.log('Browser error:', error.stack) })
  page.on('console', (message) => { if (message.type() === 'error') console.log('Browser console:', message.text()) })
  await context.addCookies([{ name: 'illus_session', value: sessionValue(E2E_ENV.ILLUS_ALLOWED_ACCOUNT_ID), url: `http://127.0.0.1:${E2E_PORT}` }])
  try {
    await page.goto('/')
    await page.locator('input[type=file]').setInputFiles(BOOK)
    await page.locator('img[alt=Cover]').first().click()
    await expect(page.frameLocator('iframe').first().locator('body')).toContainText('This synthetic book exists to test an EPUB indexer')
    await page.getByRole('button', { name: 'Open Illustrate' }).click({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Start indexing and illustrate' }).click()
    await expect(page.locator('.illus-pane')).toHaveAttribute('data-state', 'no-visual', { timeout: 60_000 })
    await page.evaluate(() => (window as any).reader.focusedBookTab.rendition.display('ch01.xhtml#s1-1'))
    await expect(page.locator('.illus-pane')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 })
    const element = page.locator('.illus-pane [data-ir-id][tabindex="0"]').first()
    await expect(element).toBeVisible()
    await element.focus(); await page.keyboard.press('Enter')
    await expect(page.frameLocator('iframe').first().locator('.illus-evidence')).toBeVisible()
    await expect(page.locator('.illus-live')).toContainText('Evidence:')
    await page.screenshot({ path: testInfo.outputPath('pane-light.png') })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.screenshot({ path: testInfo.outputPath('pane-dark.png') })
    await page.keyboard.press('Alt+i'); await expect(page.getByRole('button', { name: 'Open Illustrate' })).toBeVisible()
    await page.keyboard.press('Alt+i'); await expect(page.getByRole('region', { name: 'Illustrate' })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    writeFileSync(testInfo.outputPath('synthetic-replay-requests.json'), JSON.stringify(requests, null, 2))
    if (process.env.ILLUS_CAPTURE_PATH) writeFileSync(process.env.ILLUS_CAPTURE_PATH, JSON.stringify(requests, null, 2))
    writeFileSync(testInfo.outputPath('page-errors.json'), JSON.stringify(errors))
    await testInfo.attach('synthetic-replay-requests', { body: JSON.stringify(requests, null, 2), contentType: 'application/json' })
    await testInfo.attach('page-errors', { body: JSON.stringify(errors), contentType: 'application/json' })
  }
})
