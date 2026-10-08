import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { E2E_ENV, E2E_PORT, sessionValue } from './env'

const BOOK = join(__dirname, '../../../fixtures/books/synthetic.epub')

// ADR 0050 / R7: the graph scene player is behind `flags.sceneAnimations` (off by default, so illustrate.e2e.ts
// never reaches it). Replay has no graph animation for the synthetic book, so this seeds the stores like the
// concept-model part of illustrate.e2e.ts: the visual the replay produced becomes a three-node graph with a
// two-step animation, the flag is switched on, and the model is paused so the saved visual is drawn.
test('sceneAnimations on: a graph is played by the scene player, steps follow the book, and expanding keeps it', async ({
  context,
  page,
}) => {
  test.setTimeout(150_000)
  const errors: string[] = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.log('Browser error:', error.stack)
  })
  // Deterministic: no autoplay and no tweens, every move is a seek (the GSAP path has its own browser tests).
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await context.addCookies([
    {
      name: 'illus_session',
      value: sessionValue(E2E_ENV.ILLUS_ALLOWED_ACCOUNT_ID),
      url: `http://127.0.0.1:${E2E_PORT}`,
    },
  ])
  const openBook = async () => {
    await page.locator('img[alt=Cover]').first().click()
    await expect(
      page.frameLocator('iframe').first().locator('body'),
    ).toBeVisible({ timeout: 30_000 })
  }
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(BOOK)
  await openBook()
  await expect(
    page.frameLocator('iframe').first().locator('body'),
  ).toContainText('This synthetic book exists to test an EPUB indexer')
  await page
    .getByRole('button', { name: 'Open Illustrate' })
    .click({ timeout: 10_000 })
  await expect(page.locator('.illus-pane')).toHaveAttribute(
    'data-state',
    'no-visual',
    { timeout: 60_000 },
  )
  await page.evaluate(() =>
    (window as any).reader.focusedBookTab.rendition.display('ch01.xhtml#s1-1'),
  )
  await expect(page.locator('.illus-pane')).toHaveAttribute(
    'data-state',
    'ready',
    { timeout: 60_000 },
  )

  await page.evaluate(seedGraphWithAnimation)
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
  await openBook()
  await page.evaluate(() =>
    (window as any).reader.focusedBookTab.rendition.display('ch01.xhtml#s1-1'),
  )

  const pane = page.locator('.illus-pane')
  const scene = pane.locator('[data-scene-ready="true"]')
  await expect(scene).toBeVisible({ timeout: 60_000 })
  await expect(scene).toHaveAttribute('aria-label', 'Animation player')
  for (const id of ['scene-a', 'scene-b', 'scene-c'])
    await expect(scene.locator(`[data-ir-id="${id}"]`)).toHaveCount(1)
  const step = scene.getByLabel('Step number')
  await expect(step).toHaveText('0/2')

  // A step shows its passage in the book without the reader doing anything else.
  await scene.getByLabel('Next step').click()
  await expect(step).toHaveText('1/2')
  const mark = page.locator('.epub-view svg g.illus-step')
  await expect(mark).toBeVisible()
  expect(
    await page.evaluate(
      (c) =>
        (window as any).reader.focusedBookTab.rendition.getRange(c).toString(),
      await mark.getAttribute('data-epubcfi'),
    ),
  ).toBe('Table 1.1 Message types')
  // Clicking the narration marks the passage again and keeps it.
  await scene
    .getByRole('button', { name: 'The client sends a request.' })
    .click()
  await expect(mark).toBeVisible()

  // The large view is the same DOM: the player survives, still on its step.
  const record = pane.locator('.illus-record')
  await pane.getByRole('button', { name: 'Open large view' }).click()
  await expect(record).toHaveAttribute('data-expanded', 'true')
  await expect(scene).toBeVisible()
  await expect(step).toHaveText('1/2')
  await scene.getByLabel('Next step').click()
  await expect(step).toHaveText('2/2')
  await expect(
    scene.getByRole('button', { name: 'The leader appends to the log.' }),
  ).toBeVisible()
  await pane.getByRole('button', { name: 'Close large view' }).click()
  await expect(record).not.toHaveAttribute('data-expanded', 'true')
  await expect(scene).toBeVisible()
  await expect(step).toHaveText('2/2')

  expect(errors).toEqual([])
})

/** Runs in the page: turns the visual the replay made into a small graph with an animation, and turns the flag on. */
async function seedGraphWithAnimation() {
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
  const plan = (await run<any[]>('plans', (s) => s.getAll()))
    .filter((p) => p.sectionId === visual.sectionId)
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  const find = (v: any): any => {
    if (!v || typeof v !== 'object') return undefined
    if (v.evidence) return v.evidence
    for (const x of Object.values(v)) {
      const e = find(x)
      if (e) return e
    }
  }
  const evidence = find(visual.ir)
  visual.kind = 'graph'
  visual.spec = null
  delete visual.layout
  visual.ir = {
    type: 'graph',
    title: 'Scene e2e',
    direction: 'LR',
    nodes: [
      { id: 'scene-a', label: 'Client', shape: 'actor', evidence },
      { id: 'scene-b', label: 'Leader', shape: 'box', evidence },
      { id: 'scene-c', label: 'Log', shape: 'store', evidence },
    ],
    edges: [
      {
        id: 'scene-e1',
        from: 'scene-a',
        to: 'scene-b',
        label: 'request',
        style: 'solid',
        evidence,
      },
      {
        id: 'scene-e2',
        from: 'scene-b',
        to: 'scene-c',
        label: 'append',
        style: 'solid',
        evidence,
      },
    ],
    groups: [],
  }
  visual.animation = {
    planItemId: visual.planItemId,
    initialHidden: ['node:scene-c', 'edge:scene-e2'],
    steps: [
      {
        id: 's1',
        narration: 'The client sends a request.',
        evidence,
        actions: [{ op: 'highlight', target: 'node:scene-a', tone: 'focus' }],
      },
      {
        id: 's2',
        narration: 'The leader appends to the log.',
        evidence,
        actions: [
          { op: 'unhighlight', target: 'all' },
          { op: 'reveal', target: 'node:scene-c' },
          { op: 'reveal', target: 'edge:scene-e2' },
          { op: 'highlight', target: 'edge:scene-e2', tone: 'focus' },
        ],
      },
    ],
  }
  await run('visuals', (s) => s.put(visual))
  const item = plan.plan.items.find(
    (i: any) => i.planItemId === visual.planItemId,
  )
  Object.assign(item, { kind: 'graph' })
  await run('plans', (s) => s.put(plan))
  const settings = await run<any>('settings', (s) =>
    s.get('illustratePreferences'),
  )
  await run('settings', (s) =>
    s.put({
      key: 'illustratePreferences',
      value: {
        ...settings.value,
        flags: {
          ...settings.value.flags,
          animations: true,
          sceneAnimations: true,
        },
      },
    }),
  )
  db.close()
}
