// W11 security checks against the production build (spec §17, ADR 0005, ADR 0020).
import { join } from 'node:path'

import { expect, test } from '@playwright/test'
import type { BrowserContext } from '@playwright/test'

import { E2E_ENV, E2E_PORT, sessionValue } from './env'

const BOOK = join(__dirname, '../../../fixtures/books/synthetic.epub')

async function signIn(context: BrowserContext, sub = E2E_ENV.ILLUS_ALLOWED_ACCOUNT_ID) {
  await context.addCookies([{ name: 'illus_session', value: sessionValue(sub), url: `http://127.0.0.1:${E2E_PORT}` }])
}

test.describe('auth gate', () => {
  test('unauthenticated pages redirect to /login, APIs answer 401', async ({ request }) => {
    for (const path of ['/', '/_', '/de-DE', '/de-DE/_']) {
      const res = await request.get(path, { maxRedirects: 0 })
      expect(res.status(), path).toBe(307)
      expect(res.headers().location, path).toMatch(/\/login\?next=/)
    }
    for (const path of ['/api/llm/usage', '/api/llm']) {
      const res = await request.get(path, { maxRedirects: 0 })
      expect(res.status(), path).toBe(401)
      expect(await res.json()).toMatchObject({ ok: false, code: 'auth' })
    }
    expect((await request.post('/api/llm', { data: {} })).status()).toBe(401)
    expect((await request.get('/login')).status()).toBe(200)
    expect((await request.get('/de-DE/login')).status()).toBe(200)
  })

  test('x-middleware-subrequest does not bypass the gate (ADR 0005)', async ({ request }) => {
    for (const value of ['middleware', 'src/middleware', 'middleware:middleware:middleware:middleware:middleware']) {
      const headers = { 'x-middleware-subrequest': value }
      expect((await request.get('/', { headers, maxRedirects: 0 })).status()).toBe(307)
      expect((await request.get('/api/llm/usage', { headers, maxRedirects: 0 })).status()).toBe(401)
      expect((await request.get('/de-DE/_', { headers, maxRedirects: 0 })).status()).toBe(307)
    }
  })

  test('a session for any account other than ILLUS_ALLOWED_ACCOUNT_ID is refused', async ({ context, page }) => {
    await signIn(context, 'someone-else')
    expect((await page.request.get('/api/llm/usage', { maxRedirects: 0 })).status()).toBe(401)
    expect((await page.request.get('/', { maxRedirects: 0 })).status()).toBe(307)
  })

  test('forged and expired sessions are refused', async ({ context, page }) => {
    const url = `http://127.0.0.1:${E2E_PORT}`
    const good = sessionValue(E2E_ENV.ILLUS_ALLOWED_ACCOUNT_ID)
    await context.addCookies([{ name: 'illus_session', value: `${good.split('.')[0]}.AAAA`, url }])
    expect((await page.request.get('/api/llm/usage')).status()).toBe(401)
    await context.addCookies([{ name: 'illus_session', value: sessionValue(E2E_ENV.ILLUS_ALLOWED_ACCOUNT_ID, 1), url }])
    expect((await page.request.get('/api/llm/usage')).status()).toBe(401)
  })

  test('password login admits the allowed account with a hardened cookie', async ({ page }) => {
    await page.goto('/_')
    await expect(page).toHaveURL(/\/login\?next=%2F_/)
    await page.getByLabel('Password').fill('wrong-password-0123456789')
    await page.getByRole('button', { name: 'Continue with password' }).click()
    await expect(page.locator('p[role=alert]').first()).toHaveText('Wrong password.')

    await page.getByLabel('Password').fill(E2E_ENV.ILLUS_LOGIN_PASSWORD)
    await page.getByRole('button', { name: 'Continue with password' }).click()
    await expect(page).toHaveURL(/\/_$/)
    const [cookie] = (await page.context().cookies()).filter((c) => c.name === 'illus_session')
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' })
    expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(29 * 24 * 3600)
    expect((await page.request.get('/api/llm/usage')).status()).toBe(200)
  })

  test('/login never redirects off-site', async ({ page }) => {
    await page.goto('/login?next=//evil.example')
    expect(await page.locator('input[name=next]').inputValue()).toBe('/')
  })
})

test('/api/llm is rate limited to 60 requests per minute per session', async ({ context, page }) => {
  await signIn(context)
  const statuses: number[] = []
  for (let i = 0; i < 61; i++) statuses.push((await page.request.post('/api/llm', { data: {} })).status())
  expect(statuses.slice(0, 60)).not.toContain(429)
  const res = await page.request.post('/api/llm', { data: {} })
  expect(res.status()).toBe(429)
  expect(res.headers()['retry-after']).toBeTruthy()
  expect(await res.json()).toMatchObject({ ok: false, retryAfterMs: expect.any(Number) })
})

test.describe('headers', () => {
  test('the app CSP is present on pages, APIs and static assets', async ({ request }) => {
    for (const path of ['/login', '/theme-init.js', '/api/llm/usage', '/manifest.json']) {
      const h = (await request.get(path, { maxRedirects: 0 })).headers()
      expect(h['content-security-policy'], path).toContain("script-src 'self' 'wasm-unsafe-eval';")
      expect(h['x-content-type-options'], path).toBe('nosniff')
    }
    const h = (await request.get('/login')).headers()
    expect(h['x-frame-options']).toBe('SAMEORIGIN')
    expect(h['x-powered-by']).toBeUndefined()
  })

  test('the sandbox page has its own §17 policy', async ({ request }) => {
    const h = (await request.get('/illus-sandbox.html')).headers()
    expect(h['content-security-policy']).toBe("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:")
  })

  test('self-hosted trace assets are served with a separate worker bootstrap CSP', async ({ request }) => {
    const worker = await request.get('/illus-trace-worker.mjs')
    expect(worker.status()).toBe(200)
    expect(worker.headers()['content-security-policy']).toBe("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
    expect(worker.headers()['content-type']).toMatch(/javascript/)
    expect(worker.headers()['x-content-type-options']).toBe('nosniff')
    for (const path of ['/illus-comlink.mjs', '/illus-tracer.py', '/pyodide/pyodide.mjs', '/pyodide/pyodide.asm.wasm', '/pyodide/python_stdlib.zip']) {
      const asset = await request.get(path)
      expect(asset.status(), path).toBe(200)
      expect(asset.headers()['content-security-policy'], path).toContain("script-src 'self' 'wasm-unsafe-eval';")
    }
  })
})

test('epub.js renders a chapter under the CSP with no unexpected violations', async ({ context, page }) => {
  await signIn(context)
  const violations: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violations.push(m.text())
  })
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(BOOK)
  await page.locator('img[alt=Cover]').first().click()

  const book = page.frameLocator('iframe').first()
  await expect(book.locator('body')).toContainText('This synthetic book exists to test an EPUB indexer')
  // Book CSS arrives as a blob: stylesheet (ADR 0001); serif proves it loaded.
  expect(await book.locator('body').evaluate((b) => getComputedStyle(b).fontFamily)).toContain('serif')

  await page.evaluate(() => (window as any).reader.focusedBookTab.rendition.display('ch01.xhtml'))
  await expect(book.locator('h1')).toHaveText('Chapter 1 Basics')
  expect(violations).toEqual([])
})

test('the trace worker boots local Pyodide and runs Python under production CSP', async ({ page }) => {
  test.setTimeout(90_000)
  const violations: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) violations.push(message.text())
  })
  await page.goto('/login')
  const raw = await page.evaluate(async (comlinkUrl) => {
    const { wrap } = await import(comlinkUrl)
    const worker = new Worker('/illus-trace-worker.mjs', { type: 'module' })
    try {
      const api = wrap(worker)
      await api.ready()
      return await api.run('def f():\n  return 42', 'f()', ['f'])
    } finally {
      worker.terminate()
    }
  }, '/illus-comlink.mjs')
  expect(raw.error).toBeUndefined()
  expect(raw.steps.length).toBeGreaterThan(0)
  expect(violations).toEqual([])
})

test('the sandbox iframe cannot read cookies or the parent DOM', async ({ context, page }) => {
  await signIn(context)
  await page.goto('/login')
  const result = await page.evaluate(
    () =>
      new Promise<Record<string, string>>((resolve) => {
        const frame = document.createElement('iframe')
        frame.setAttribute('sandbox', 'allow-scripts')
        frame.src = '/illus-sandbox.html'
        window.addEventListener('message', (e) => {
          if (e.source === frame.contentWindow) resolve(e.data)
        })
        frame.onload = () =>
          frame.contentWindow!.postMessage(
            {
              type: 'illus-html',
              html: `<script>
                var r = {};
                try { r.cookie = 'read:' + document.cookie } catch (e) { r.cookie = 'blocked:' + e.name }
                try { r.parent = 'read:' + parent.document.title } catch (e) { r.parent = 'blocked:' + e.name }
                try { r.storage = 'read:' + localStorage.length } catch (e) { r.storage = 'blocked:' + e.name }
                parent.postMessage(r, '*');
              </script>`,
            },
            '*',
          )
        document.body.appendChild(frame)
      }),
  )
  expect(result.cookie).toMatch(/^blocked:/)
  expect(result.parent).toMatch(/^blocked:/)
  expect(result.storage).toMatch(/^blocked:/)
})
