// Auth-gate rules shared by the Edge middleware (spec §17, ADR 0020). Web APIs only: no Node imports.

export type Access = 'public' | 'api' | 'page'

const LOCALE = '(?:/[a-z]{2}-[A-Z]{2})?'
const PUBLIC = [
  new RegExp(`^${LOCALE}/login/?$`),
  new RegExp(`^${LOCALE}/auth/chatgpt/[^/]+/?$`), // W2 handlers check the session themselves where needed
  /^\/api\/auth\/chatgpt\/[^/]+\/?$/, // rewrite destination of the line above
  /^\/api\/login\/?$/,
  /^\/_next\/static\//,
]
const API = new RegExp(`^${LOCALE}/(?:api|_next/data)(?:/|$)`)
// Static files from public/ (icons, manifest, sw.js, theme-init.js, illus-sandbox.html, pyodide/*).
const STATIC_FILE = /\/[^/]+\.[a-z0-9]+$/i

/** Which gate applies to a request path. Unknown paths are gated, never public. */
export function classify(pathname: string): Access {
  if (PUBLIC.some((re) => re.test(pathname))) return 'public'
  if (API.test(pathname)) return 'api'
  if (STATIC_FILE.test(pathname)) return 'public'
  return 'page'
}

export const SIGNIN_ROUTE = new RegExp(
  `^${LOCALE}/(?:api/)?auth/chatgpt/(?:start|paste|callback)/?$`,
)

/** Must match `SESSION_COOKIE` in `@illus/llm/server` (not imported: that module is Node-only). */
export const SESSION_COOKIE = 'illus_session'

const enc = new TextEncoder()
let cachedKey: { secret: string; key: Promise<CryptoKey> } | undefined

function hmacKey(secret: string) {
  if (cachedKey?.secret !== secret)
    cachedKey = {
      secret,
      key: crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    }
  return cachedKey.key
}

function fromBase64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null
  const b64 =
    s.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (s.length % 4)) % 4)
  try {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

/**
 * Verifies an `illus_session` cookie value written by `createSessions().issueSession` in
 * `@illus/llm/server`: `<base64url JSON claims>.<base64url HMAC-SHA256>`. Admits only `allowedSub`
 * (`ILLUS_ALLOWED_ACCOUNT_ID`) in owner mode, or any signed identity in open mode. Node routes
 * additionally check revocation and disabled users in SQLite.
 */
export async function verifySessionValue(
  value: string | undefined,
  o: {
    secret: string | undefined
    allowedSub?: string | undefined
    nowS: number
    open?: boolean
  },
): Promise<boolean> {
  if (!value || !o.secret || o.secret.length < 32 || (!o.open && !o.allowedSub))
    return false
  const [payload, mac, extra] = value.split('.')
  if (!payload || !mac || extra !== undefined) return false
  const sig = fromBase64url(mac)
  if (!sig) return false
  // crypto.subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(o.secret),
    sig,
    enc.encode(payload),
  )
  if (!ok) return false
  try {
    const bytes = fromBase64url(payload)
    const claims =
      bytes &&
      (JSON.parse(new TextDecoder().decode(bytes)) as {
        sid?: unknown
        sub?: unknown
        exp?: unknown
      })
    return (
      !!claims &&
      typeof claims.sid === 'string' &&
      !!claims.sid &&
      typeof claims.sub === 'string' &&
      !!claims.sub &&
      (o.open || claims.sub === o.allowedSub) &&
      typeof claims.exp === 'number' &&
      claims.exp > o.nowS
    )
  } catch {
    return false
  }
}
