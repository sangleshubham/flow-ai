import { describe, expect, it } from 'vitest'

import { appCsp, runtimeCaching, SANDBOX_CSP, securityHeaders, TRACE_WORKER_CSP } from '../../security-headers.js'

describe('security headers', () => {
  it('app CSP is the §17 policy plus the ADR 0001 exceptions, with no unsafe-inline or unsafe-eval scripts', () => {
    const csp: string = appCsp(false)
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval';")
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/)
    expect(csp).toContain("connect-src 'self' blob:")
    expect(csp).toContain("style-src 'self' 'unsafe-inline' blob:")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'self'")
    expect(appCsp(true)).toContain("'unsafe-eval'")
  })

  it('the sandbox page gets only the §17 sandbox policy, without frame-ancestors', () => {
    expect(SANDBOX_CSP).toBe("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:")
    const rules = securityHeaders({ dev: false }) as { source: string; headers: { key: string; value: string }[] }[]
    expect(rules.map((r) => r.source)).toEqual(['/:path((?!(?:illus-sandbox\\.html|illus-trace-worker\\.mjs)$).*)', '/illus-sandbox.html', '/illus-trace-worker.mjs'])
    const sandbox = rules[1]!.headers.find((h) => h.key === 'Content-Security-Policy')
    expect(sandbox?.value).toBe(SANDBOX_CSP)
    expect(sandbox?.value).not.toContain('frame-ancestors')
  })

  it('the trace worker bootstraps self-hosted wasm and scripts without child workers or documents', () => {
    expect(TRACE_WORKER_CSP).toBe("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
    expect(TRACE_WORKER_CSP).not.toMatch(/unsafe-inline|(?:^|\s)'unsafe-eval'|blob:|https?:/)
    const rules = securityHeaders({ dev: true }) as { source: string; headers: { key: string; value: string }[] }[]
    const worker = rules.find((r) => r.source === '/illus-trace-worker.mjs')!
    expect(worker.headers.find((h) => h.key === 'Content-Security-Policy')?.value).toBe(TRACE_WORKER_CSP)
    expect(worker.headers.find((h) => h.key === 'X-Content-Type-Options')?.value).toBe('nosniff')
  })

  it('the service worker never caches sign-in, login or API responses', () => {
    const [first, ...rest] = runtimeCaching() as { urlPattern: unknown; handler: string; options?: { cacheName?: string } }[]
    expect(first!.handler).toBe('NetworkOnly')
    const match = first!.urlPattern as (o: { url: URL }) => boolean
    ;(globalThis as { self?: unknown }).self = { origin: 'https://r.example' }
    const m = (p: string) => match({ url: new URL(p, 'https://r.example') })
    for (const p of ['/auth/chatgpt/callback?code=1', '/de-DE/auth/chatgpt/start', '/api/llm', '/api/llm/usage', '/login', '/de-DE/login', '/_next/data/b/login.json'])
      expect(m(p), p).toBe(true)
    for (const p of ['/', '/_next/static/chunks/main.js', '/icons/192.png']) expect(m(p), p).toBe(false)
    expect(rest.some((r) => r.options?.cacheName === 'apis')).toBe(false)
  })
})
