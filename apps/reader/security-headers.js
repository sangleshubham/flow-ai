// Security headers for next.config.js `headers()` (spec §17, ADR 0001 amended policy, ADR 0020). W11.
// CommonJS because next.config.js requires it.
/* global self */

/** App policy: §17 plus the ADR 0001 exceptions epub.js needs. Dev adds 'unsafe-eval' for React Refresh. */
function appCsp(dev) {
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`,
    "worker-src 'self' blob:",
    "connect-src 'self' blob:",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline' blob:",
    "font-src 'self' blob: data:",
    "media-src 'self' blob:",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ')
}

/**
 * §17 sandbox policy. No frame-ancestors: the page is framed by the app with sandbox="allow-scripts"
 * (opaque origin), and its own CSP must not get in the way (ADR 0001 item 6).
 */
const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"

const COMMON = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  // Ignored by browsers over plain http (local run); effective behind Caddy or tailscale serve.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
]

function securityHeaders({ dev }) {
  return [
    {
      // Every path except the sandbox page, which gets its own policy below (with overlapping rules Next
      // keeps the first value of a header key, so the two must not overlap). No `locale: false`: with i18n,
      // Next 12.3 matches headers against the locale-prefixed path, like rewrites (ADR 0007 item 11).
      // Covers pages, /api/*, /_next/static (worker scripts) and /pyodide/* (W7's worker gets its CSP here).
      source: '/:path((?!illus-sandbox\\.html$).*)',
      headers: [
        ...COMMON,
        { key: 'Content-Security-Policy', value: appCsp(dev) },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      ],
    },
    {
      source: '/illus-sandbox.html',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Content-Security-Policy', value: SANDBOX_CSP },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ],
    },
  ]
}

/**
 * next-pwa runtime caching: never cache sign-in, login or API responses (flow-audit §7). Workbox uses
 * the first matching rule, so a NetworkOnly rule goes first; the rest is next-pwa's default list.
 * The matcher is serialised into sw.js, so it must not close over anything.
 */
function runtimeCaching() {
  const defaults = require('next-pwa/cache')
  return [
    {
      urlPattern: ({ url }) =>
        self.origin === url.origin && /(?:^|\/)(?:api|auth)\/|\/login(?:\.json)?$/.test(url.pathname),
      handler: 'NetworkOnly',
    },
    ...defaults.filter((r) => r.options?.cacheName !== 'apis'),
  ]
}

module.exports = { appCsp, SANDBOX_CSP, securityHeaders, runtimeCaching }
