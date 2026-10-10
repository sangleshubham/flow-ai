import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { E2E_ENV, E2E_PORT, sessionValue } from './env'

const BOOK = join(__dirname, '../../../fixtures/books/synthetic.epub')
test('open book → navigate → visual → evidence highlights the quoted passage; keyboard pane controls', async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const requests: unknown[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/llm') && request.method() === 'POST') {
      requests.push(request.postDataJSON())
      if (process.env.ILLUS_CAPTURE_PATH)
        writeFileSync(
          process.env.ILLUS_CAPTURE_PATH,
          JSON.stringify(requests, null, 2),
        )
    }
  })
  const errors: string[] = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.log('Browser error:', error.stack)
  })
  const serverErrors: string[] = []
  page.on('response', (response) => {
    if (response.status() >= 500)
      serverErrors.push(
        `${response.status()} ${response.request().method()} ${response.url()}`,
      )
  })
  page.on('console', (message) => {
    if (message.type() === 'error')
      console.log('Browser console:', message.text())
  })
  await context.addCookies([
    {
      name: 'illus_session',
      value: sessionValue(E2E_ENV.ILLUS_ALLOWED_ACCOUNT_ID),
      url: `http://127.0.0.1:${E2E_PORT}`,
    },
  ])
  try {
    await page.goto('/')
    await page.locator('input[type=file]').setInputFiles(BOOK)
    await page.locator('img[alt=Cover]').first().click()
    await expect(
      page.frameLocator('iframe').first().locator('body'),
    ).toContainText('This synthetic book exists to test an EPUB indexer')
    await page
      .getByRole('button', { name: 'Open Illustrate' })
      .click({ timeout: 10_000 })
    // The synthetic book is far below the 200,000-token confirmation threshold (ADR 0010), so no prompt.
    await expect(page.locator('.illus-pane')).toHaveAttribute(
      'data-state',
      'no-visual',
      { timeout: 60_000 },
    )
    await page.evaluate(() =>
      (window as any).reader.focusedBookTab.rendition.display(
        'ch01.xhtml#s1-1',
      ),
    )
    await expect(page.locator('.illus-pane')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: 60_000 },
    )
    // Mermaid emits edges first and a straight edge has a zero-width box, so focus a node element.
    const element = page
      .locator('.illus-pane [data-ir-id][data-target^="node:"][tabindex="0"]')
      .first()
    await expect(element).toBeVisible()
    await element.focus()
    await page.keyboard.press('Enter')
    // epub.js draws marks in an SVG over the chapter iframe; the mark must cover the quoted passage.
    const mark = page.locator('.epub-view svg g.illus-evidence')
    await expect(mark).toBeVisible()
    const cfi = await mark.getAttribute('data-epubcfi')
    expect(
      await page.evaluate(
        (c) =>
          (window as any).reader.focusedBookTab.rendition
            .getRange(c)
            .toString(),
        cfi,
      ),
    ).toBe('Table 1.1 Message types')
    await expect(page.locator('.illus-live')).toContainText('Evidence:')
    await page.screenshot({ path: testInfo.outputPath('pane-light.png') })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.screenshot({ path: testInfo.outputPath('pane-dark.png') })
    await page.keyboard.press('Alt+i')
    await expect(
      page.getByRole('button', { name: 'Open Illustrate' }),
    ).toBeVisible()
    await page.keyboard.press('Alt+i')
    await expect(page.getByRole('region', { name: 'Illustrate' })).toBeVisible()

    // §13 concept-model view and the §16 warning badge. Replay has no patcher or critic fixtures for the
    // synthetic book, so this seeds the stores directly: a two-patch model on the visible item, a failing
    // critic report, and the conceptModels flag. The plan is then paused, so nothing new is generated and
    // the pane must show the saved visual (with the badge) drawn from the model.
    await page.evaluate(seedConceptModel)
    await page.route('**/api/llm', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          code: 'plan-limit',
          message: 'E2E: plan paused',
        }),
      }),
    )
    await page.reload()
    await page.locator('img[alt=Cover]').first().click()
    await expect(
      page.frameLocator('iframe').first().locator('body'),
    ).toBeVisible({ timeout: 30_000 })
    await page.evaluate(() =>
      (window as any).reader.focusedBookTab.rendition.display(
        'ch01.xhtml#s1-1',
      ),
    )
    const model = page.locator('.illus-pane [data-concept-model="e2e-model"]')
    await expect(model).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('quality-warning')).toContainText(
      'Quality review flagged this visual',
    )
    await expect(model.locator('[data-ir-id="e2e-earlier"]')).toBeVisible()
    await expect(model.locator('[data-ir-id="e2e-new"]')).toBeVisible()
    await expect(model.locator('[data-ir-id="e2e-other"]')).toBeVisible()
    await page.getByLabel("Only this section's additions").check()
    await expect(model.locator('[data-ir-id="e2e-new"]')).toBeVisible()
    // The new edge's endpoint stays; the unconnected earlier node goes.
    await expect(model.locator('[data-ir-id="e2e-earlier"]')).toBeVisible()
    await expect(model.locator('[data-ir-id="e2e-other"]')).toHaveCount(0)
    await page.getByLabel("Only this section's additions").uncheck()
    await model.getByText('How this model grew').click()
    await expect(model.getByRole('slider')).toBeVisible()
    // Evidence from the model's element still highlights the passage in the book.
    const newNode = model
      .locator('[data-ir-id="e2e-new"][tabindex="0"]')
      .first()
    await newNode.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.epub-view svg g.illus-evidence')).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('pane-concept-model.png'),
    })
    expect(errors).toEqual([])
    expect(serverErrors).toEqual([])
  } finally {
    writeFileSync(
      testInfo.outputPath('synthetic-replay-requests.json'),
      JSON.stringify(requests, null, 2),
    )
    if (process.env.ILLUS_CAPTURE_PATH)
      writeFileSync(
        process.env.ILLUS_CAPTURE_PATH,
        JSON.stringify(requests, null, 2),
      )
    writeFileSync(
      testInfo.outputPath('page-errors.json'),
      JSON.stringify(errors),
    )
    await testInfo.attach('synthetic-replay-requests', {
      body: JSON.stringify(requests, null, 2),
      contentType: 'application/json',
    })
    await testInfo.attach('page-errors', {
      body: JSON.stringify(errors),
      contentType: 'application/json',
    })
  }
})

/** Runs in the page: seeds the `illus` IndexedDB (raw API, Dexie's tables are plain object stores). */
async function seedConceptModel() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('illus')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  const run = <T>(store: string, fn: (s: IDBObjectStore) => IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction(store, 'readwrite').objectStore(store))
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
  const visual = (await run<any[]>('visuals', (s) => s.getAll())).sort(
    (a, b) => b.createdAt - a.createdAt,
  )[0]
  const section = await run<any>('sections', (s) => s.get(visual.sectionId))
  const plan = (await run<any[]>('plans', (s) => s.getAll()))
    .filter((p) => p.sectionId === visual.sectionId)
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  const evidence = findEvidence(visual.ir)
  function findEvidence(v: any): any {
    if (!v || typeof v !== 'object') return undefined
    if (v.evidence) return v.evidence
    for (const x of Object.values(v)) {
      const e = findEvidence(x)
      if (e) return e
    }
  }
  const createdWith = { model: 'e2e', promptVersion: 'e2e' }
  const node = (id: string, label: string) => ({
    op: 'addNode',
    node: { id, label, shape: 'box', evidence },
  })
  await run('conceptModels', (s) =>
    s.put({
      conceptModelId: 'e2e-model',
      conceptId: 'e2e-concept',
      bookId: visual.bookId,
      kind: 'graph',
      patches: [
        {
          patchId: 'e2e@0',
          sectionId: 'e2e-earlier-section',
          sectionOrdinal: Math.max(0, section.ordinal - 1),
          ops: [
            node('e2e-earlier', 'Earlier idea'),
            node('e2e-other', 'Unrelated idea'),
          ],
          createdWith,
        },
        {
          patchId: 'e2e@1',
          sectionId: section.sectionId,
          sectionOrdinal: section.ordinal,
          ops: [
            node('e2e-new', 'New idea'),
            {
              op: 'addEdge',
              edge: {
                id: 'e2e-edge',
                from: 'e2e-earlier',
                to: 'e2e-new',
                style: 'solid',
                evidence,
              },
            },
          ],
          createdWith,
        },
      ],
    }),
  )
  const item = plan.plan.items.find(
    (i: any) => i.planItemId === visual.planItemId,
  )
  Object.assign(item, { kind: 'graph', conceptModelId: 'e2e-model' })
  await run('plans', (s) => s.put(plan))
  visual.critic = {
    pass: false,
    scores: { legibility: 2, intentMatch: 4, clutter: 3 },
    issues: [{ kind: 'overlap', note: 'E2E: labels overlap' }],
  }
  await run('visuals', (s) => s.put(visual))
  const settings = await run<any>('settings', (s) =>
    s.get('illustratePreferences'),
  )
  await run('settings', (s) =>
    s.put({
      key: 'illustratePreferences',
      value: {
        ...settings.value,
        flags: { ...settings.value.flags, conceptModels: true },
      },
    }),
  )
  db.close()
}
