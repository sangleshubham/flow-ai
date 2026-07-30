// In-process fake of OpenAI's OIDC server (discovery, JWKS, authorize consent, token, refresh, revoke),
// reached through openid-client's customFetch. No sockets, no network.
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')

export interface FakeOidcOptions {
  issuer?: string
  sub?: string
  email?: string
  /** Scopes granted in token responses (default: everything requested). */
  grantScope?: string
  now?: () => number
}

export function createFakeOidc(o: FakeOidcOptions = {}) {
  const issuer = o.issuer ?? 'https://auth.test'
  const now = o.now ?? Date.now
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
  const codes = new Map<string, { clientId: string; nonce: string; challenge: string; redirectUri: string; scope: string }>()
  const refreshTokens = new Map<string, { clientId: string; sub: string }>()
  const state = {
    sub: o.sub ?? 'user-abc',
    email: o.email ?? 'shubham@example.com',
    issuedClientId: 'oaiapp_test123',
    revoked: [] as string[],
    tokenRequests: [] as Record<string, string>[],
    /** Next refresh fails with this OAuth error. */
    failNextRefresh: undefined as string | undefined,
    /** Signs ID tokens with this nonce instead of the requested one (replay attack). */
    forceNonce: undefined as string | undefined,
  }

  const idToken = (clientId: string, nonce?: string) => {
    const t = Math.floor(now() / 1000)
    const header = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }))
    const payload = b64url(
      JSON.stringify({ iss: issuer, aud: clientId, sub: state.sub, email: state.email, iat: t, exp: t + 3600, ...(nonce && { nonce }) }),
    )
    return `${header}.${payload}.${b64url(sign('sha256', Buffer.from(`${header}.${payload}`), privateKey))}`
  }

  const tokens = (clientId: string, scope: string, nonce?: string) => {
    const refresh = `rt_${randomUUID()}`
    refreshTokens.set(refresh, { clientId, sub: state.sub })
    return {
      access_token: `at_${randomUUID()}`,
      refresh_token: refresh,
      id_token: idToken(clientId, nonce),
      token_type: 'Bearer',
      expires_in: 3600,
      scope: o.grantScope ?? scope,
    }
  }

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    const form = Object.fromEntries(new URLSearchParams(String(init?.body ?? '')))
    switch (url.pathname) {
      case '/.well-known/openid-configuration':
        return json({
          issuer,
          authorization_endpoint: `${issuer}/api/accounts/authorize`,
          token_endpoint: `${issuer}/api/accounts/oauth/token`,
          revocation_endpoint: `${issuer}/oauth/revoke`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
        })
      case '/jwks':
        return json({ keys: [jwk] })
      case '/api/accounts/oauth/token': {
        state.tokenRequests.push(form)
        if (form.grant_type === 'authorization_code') {
          const c = codes.get(form.code ?? '')
          codes.delete(form.code ?? '')
          const verifierOk = c && b64url(createHash('sha256').update(form.code_verifier ?? '').digest()) === c.challenge
          if (!c || !verifierOk || form.client_id !== c.clientId || form.redirect_uri !== c.redirectUri || form.resource !== 'https://api.openai.com/v1')
            return json({ error: 'invalid_grant' }, 400)
          return json(tokens(c.clientId, c.scope, state.forceNonce ?? c.nonce))
        }
        if (form.grant_type === 'refresh_token') {
          if (state.failNextRefresh) {
            const error = state.failNextRefresh
            state.failNextRefresh = undefined
            return json({ error }, error === 'server_error' ? 500 : 400)
          }
          const rt = refreshTokens.get(form.refresh_token ?? '')
          if (!rt || rt.clientId !== form.client_id || form.resource !== 'https://api.openai.com/v1') return json({ error: 'invalid_grant' }, 400)
          refreshTokens.delete(form.refresh_token!) // rotation
          const { id_token: _drop, ...rest } = tokens(rt.clientId, 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct')
          return json(rest)
        }
        return json({ error: 'unsupported_grant_type' }, 400)
      }
      case '/oauth/revoke':
        state.revoked.push(form.token ?? '')
        refreshTokens.delete(form.token ?? '')
        return new Response(null, { status: 200 })
      default:
        return json({ error: 'not_found' }, 404)
    }
  }) as typeof globalThis.fetch

  /** The user consents at the authorization URL; returns the callback query parameters. */
  function consent(authorizationUrl: string): URLSearchParams {
    const u = new URL(authorizationUrl)
    const q = u.searchParams
    const requested = q.get('client_id')!
    const clientId = requested === 'dynamic_agent_client' ? state.issuedClientId : requested
    const code = `code_${randomUUID()}`
    codes.set(code, { clientId, nonce: q.get('nonce')!, challenge: q.get('code_challenge')!, redirectUri: q.get('redirect_uri')!, scope: q.get('scope')! })
    const out = new URLSearchParams({ code, state: q.get('state')! })
    if (requested === 'dynamic_agent_client') out.set('client_id', clientId)
    return out
  }

  return { issuer, fetch, consent, state }
}
