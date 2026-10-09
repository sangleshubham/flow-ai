// §17: malicious labels never execute in any renderer; the HTML fallback is confined to its sandbox;
// everything renders under the app CSP without 'unsafe-eval'.
import { expect, test } from '@playwright/test'

import { open } from './helpers.ts'

const XSS_FIXTURES = ['xss-graph', 'xss-sequence', 'xss-state', 'xss-class', 'xss-er', 'xss-chart', 'xss-math', 'xss-timeline']

for (const name of XSS_FIXTURES) {
  test(`${name}: hostile labels render as text and never run`, async ({ page }) => {
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(d.message())
      void d.dismiss()
    })
    const { view } = await open(page, name)
    // Give injected handlers (img onerror, mouseover) a chance to fire.
    await view.hover()
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.__xss)).toBeUndefined()
    expect(dialogs).toEqual([])
    const markup = await view.evaluate((el) => ({
      scripts: el.querySelectorAll('script').length,
      imgs: el.querySelectorAll('img').length,
      handlers: [...el.querySelectorAll('*')].filter((n) => [...n.attributes].some((a) => a.name.startsWith('on'))).length,
      foreign: el.querySelectorAll('foreignObject').length,
    }))
    expect(markup).toEqual({ scripts: 0, imgs: 0, handlers: 0, foreign: 0 })
    expect(await page.evaluate(() => window.__csp)).toEqual([])
  })
}

test('the HTML fallback runs only inside a sandbox without allow-same-origin', async ({ page }) => {
  await open(page, 'html-probe')
  const iframe = page.locator('iframe')
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
  await expect(iframe).toHaveAttribute('src', '/illus-sandbox.html')
  await expect.poll(() => page.evaluate(() => window.__probe), { timeout: 10_000 }).toBeTruthy()
  const probe = (await page.evaluate(() => window.__probe)) as Record<string, unknown>
  expect(probe).toEqual({ ran: true, parentDom: 'blocked', cookie: 'blocked', storage: 'blocked', idb: 'blocked', fetch: 'blocked' })
  await expect(page.locator('[data-badge="unverified"]')).toBeVisible()
  // No evidence links inside the fallback.
  expect(await page.locator('.illus-view [data-ir-id]').count()).toBe(0)
})

test('the sandbox page accepts one document, from its parent only', async ({ page }) => {
  await open(page, 'html-off')
  await page.evaluate(() => {
    const f = document.createElement('iframe')
    f.id = 'sb'
    f.src = '/illus-sandbox.html'
    document.body.append(f)
    return new Promise((r) => f.addEventListener('load', r))
  })
  const frame = page.frame({ url: /illus-sandbox\.html/ })!
  // A message whose source is not the parent window (here: the sandbox itself) is ignored.
  await frame.evaluate(() => window.postMessage({ type: 'illus-html', html: '<p id="x">self</p>' }, '*'))
  await page.waitForTimeout(100)
  expect(await frame.locator('#x').count()).toBe(0)
  const csp = await frame.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toBe("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:")
  const post = (html: string) =>
    page.evaluate((h) => (document.getElementById('sb') as HTMLIFrameElement).contentWindow!.postMessage({ type: 'illus-html', html: h }, '*'), html)
  await post('<p id="x">first</p>')
  await expect(frame.locator('#x')).toHaveText('first')
  await post('<p id="x">second</p>')
  await page.waitForTimeout(100)
  await expect(frame.locator('#x')).toHaveText('first')
})
