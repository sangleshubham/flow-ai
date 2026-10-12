// Sign in with ChatGPT, plan usage for open-source clients (§9; OpenAI "Registration and sign-in",
// "Accounts and sessions", "Errors and recovery"; ADR 0007). OIDC authorization code + PKCE through
// `openid-client`, started by the server. First sign-in registers the client dynamically
// (`client_id=dynamic_agent_client`) and the callback returns the issued `oaiapp_…` id, which is saved.
import * as oidc from 'openid-client'

import { SigninRequiredError } from './gateway.ts'
import { seal, unseal } from './token-store.ts'
import type { StoredTokens, TokenStore } from './token-store.ts'

export const CHATGPT_ISSUER = 'https://auth.openai.com'
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1'
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct'
export const CHATGPT_SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`
export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client'
export const AGENT_NAME = 'AI Illustrated Reader'
export const CALLBACK_PATH = '/auth/chatgpt/callback'
/**
 * Redirect URI for a reader that is not on `127.0.0.1` (ADR 0047). OpenAI only redirects to a loopback, so the
 * browser lands on this address (where nothing listens) and the user pastes it back into the reader.
 */
export const PASTE_REDIRECT_URI = `http://127.0.0.1:7199${CALLBACK_PATH}`
/** Refresh when the access token expires within this window (§9 step 2). */
export const REFRESH_WINDOW_MS = 5 * 60_000
const PENDING_TTL_MS = 10 * 60_000
const AAD_PENDING = 'illus:chatgpt-pending:v1'
/** Refresh errors after which the token set is unusable (OpenAI "Refresh errors"). */
const TERMINAL_REFRESH = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
])

/** The callback authenticated someone other than the reader's owner (§17). Nothing was stored. */
export class AccountRefusedError extends Error {
  readonly sub: string
  readonly reason: 'owner' | 'unset' | 'email'
  constructor(
    sub: string,
    reason: 'owner' | 'unset' | 'email',
    email?: string,
  ) {
    super(
      reason === 'email'
        ? `This ChatGPT account (${
            email ?? sub
          }) is not allowed on this reader.`
        : reason === 'owner'
        ? 'This ChatGPT account is not allowed to use this reader.'
        : `ILLUS_ALLOWED_ACCOUNT_ID is not set. Set it to ${sub} and sign in again.`,
    )
    this.name = 'AccountRefusedError'
    this.sub = sub
    this.reason = reason
  }
}

export interface ChatGptAuthOptions {
  store: TokenStore
  /** `ILLUS_TOKEN_ENC_KEY`, also used to seal the pending-login cookie. */
  key: Buffer
  /** `ILLUS_PUBLIC_URL`; the redirect URI is `${publicUrl}/auth/chatgpt/callback`. */
  publicUrl: string
  access:
    | { mode: 'open'; allowedEmails?: string[] }
    | { mode: 'owner'; allowedAccountId?: string; claimOwner?: boolean }
  /** Overrides `${publicUrl}/auth/chatgpt/callback`, e.g. `PASTE_REDIRECT_URI` for a remote reader. */
  redirectUri?: string
  /** `ILLUS_CHATGPT_CLIENT_ID`; otherwise the saved issued id, otherwise dynamic registration. */
  clientId?: string
  issuer?: string
  /** Injected in tests (fake OIDC server); never set in production. */
  fetch?: typeof fetch
  now?: () => number
}

export interface PendingLogin {
  state: string
  nonce: string
  verifier: string
  clientId: string
  redirectUri: string
  exp: number
  next?: string
}

export interface AuthStatus {
  signedIn: boolean
  sub?: string
  email?: string
  /** `chatgpt.tokens.use.direct` was granted. */
  planUsage: boolean
  expiresAt?: number
  clientId?: string
}

export interface ChatGptAuth {
  /** Authorization URL plus the sealed pending-login value for a short-lived HttpOnly cookie. */
  start(o?: {
    sub?: string
    next?: string
  }): Promise<{ url: string; pending: string }>
  /** Validates the callback, exchanges the code, verifies the ID token, stores the tokens. */
  callback(
    params: URLSearchParams,
    pending: string | undefined,
  ): Promise<{ sub: string; email?: string; next?: string }>
  /** Access token for the plan route, refreshed when it expires within 5 minutes. Server only. */
  getPlanToken(sub: string): Promise<string>
  /** Revokes the refresh token and clears the stored tokens (registration and host id are kept). */
  logout(sub: string): Promise<{ revoked: boolean }>
  status(sub: string): Promise<AuthStatus>
}

export function createChatGptAuth(o: ChatGptAuthOptions): ChatGptAuth {
  const issuer = o.issuer ?? CHATGPT_ISSUER
  const now = o.now ?? Date.now
  const redirectUri = o.redirectUri ?? new URL(CALLBACK_PATH, o.publicUrl).href
  let server: Promise<oidc.ServerMetadata> | undefined
  const refreshing = new Map<string, Promise<string>>()

  const config = async (clientId: string) => {
    server ??= oidc
      .discovery(
        new URL(issuer),
        clientId,
        undefined,
        oidc.None(),
        o.fetch ? { [oidc.customFetch]: o.fetch as oidc.CustomFetch } : {},
      )
      .then((c) => c.serverMetadata())
      .catch((e: unknown) => {
        server = undefined
        throw e
      })
    const c = new oidc.Configuration(
      await server,
      clientId,
      undefined,
      oidc.None(),
    )
    if (o.fetch) c[oidc.customFetch] = o.fetch as oidc.CustomFetch
    return c
  }

  async function savedClientId(): Promise<string | undefined> {
    return o.clientId ?? (await o.store.loadRegistration()).clientId
  }

  async function revoke(
    clientId: string,
    refreshToken: string,
  ): Promise<boolean> {
    try {
      await oidc.tokenRevocation(await config(clientId), refreshToken, {
        token_type_hint: 'refresh_token',
      })
      return true
    } catch {
      return false
    }
  }

  async function refresh(t: StoredTokens): Promise<string> {
    if (!t.refreshToken) {
      await o.store.clearTokens(t.sub)
      throw new SigninRequiredError(
        'the ChatGPT session expired; sign in again',
      )
    }
    let res: Awaited<ReturnType<typeof oidc.refreshTokenGrant>>
    try {
      res = await oidc.refreshTokenGrant(
        await config(t.clientId),
        t.refreshToken,
        { resource: CHATGPT_RESOURCE },
      )
    } catch (e) {
      if (
        e instanceof oidc.ResponseBodyError &&
        (TERMINAL_REFRESH.has(e.error) || e.error === 'invalid_client')
      ) {
        await o.store.clearTokens(t.sub)
        throw new SigninRequiredError(
          `ChatGPT refresh failed (${e.error}); sign in again`,
        )
      }
      throw e // network or 5xx: keep the tokens (OpenAI "Disconnection")
    }
    const next: StoredTokens = {
      ...t,
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? t.refreshToken,
      ...(res.id_token && { idToken: res.id_token }),
      tokenType: res.token_type ?? t.tokenType,
      expiresAt: now() + (res.expires_in ?? 3600) * 1000,
      scope: res.scope ?? t.scope,
      savedAt: now(),
    }
    await o.store.saveTokens(next)
    return next.accessToken
  }

  return {
    async start(options) {
      const registration = await o.store.loadRegistration()
      const tokens = options?.sub
        ? await o.store.loadTokens(options.sub).catch(() => undefined)
        : undefined
      const issued =
        o.access.mode === 'owner' ? await savedClientId() : tokens?.clientId
      const clientId = issued ?? DYNAMIC_CLIENT_ID
      const verifier = oidc.randomPKCECodeVerifier()
      const pendingLogin: PendingLogin = {
        state: oidc.randomState(),
        nonce: oidc.randomNonce(),
        verifier,
        clientId,
        redirectUri,
        exp: now() + PENDING_TTL_MS,
        ...(options?.next && { next: safeNext(options.next) }),
      }
      const url = oidc.buildAuthorizationUrl(await config(clientId), {
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: CHATGPT_SCOPES,
        resource: CHATGPT_RESOURCE,
        state: pendingLogin.state,
        nonce: pendingLogin.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        ext_agent_host_id: registration.hostId,
        ...(issued ? {} : { agent_name_hint: AGENT_NAME }),
        ...(issued &&
          tokens?.idToken &&
          tokens.clientId === issued && { id_token_hint: tokens.idToken }),
      })
      return {
        url: url.href,
        pending: seal(o.key, JSON.stringify(pendingLogin), AAD_PENDING),
      }
    },

    async callback(params, pendingValue) {
      if (!pendingValue)
        throw new Error(
          'no sign-in in progress (missing or expired cookie); start again',
        )
      let p: PendingLogin
      try {
        p = JSON.parse(unseal(o.key, pendingValue, AAD_PENDING)) as PendingLogin
      } catch {
        throw new Error('invalid sign-in state; start again')
      }
      if (p.exp < now()) throw new Error('sign-in took too long; start again')
      if (params.get('state') !== p.state)
        throw new Error('state mismatch; start again')
      if (params.get('error'))
        throw new Error(
          `ChatGPT sign-in was not completed: ${params.get('error')}`,
        )
      const returned = params.get('client_id') ?? undefined
      let clientId = p.clientId
      if (p.clientId === DYNAMIC_CLIENT_ID) {
        if (!returned || returned === DYNAMIC_CLIENT_ID)
          throw new Error(
            'registration incomplete: no issued client_id in the callback',
          )
        clientId = returned
      } else if (returned && returned !== p.clientId)
        throw new Error('client_id mismatch in the callback')

      let registration = await o.store.loadRegistration()
      if (
        o.access.mode === 'owner' &&
        registration.clientId !== clientId &&
        !o.clientId
      ) {
        registration = { ...registration, clientId }
        await o.store.saveRegistration(registration)
      }

      const currentUrl = new URL(p.redirectUri)
      for (const [k, v] of params) currentUrl.searchParams.append(k, v)
      const res = await oidc.authorizationCodeGrant(
        await config(clientId),
        currentUrl,
        {
          pkceCodeVerifier: p.verifier,
          expectedState: p.state,
          expectedNonce: p.nonce,
          idTokenExpected: true,
        },
        { resource: CHATGPT_RESOURCE },
      )
      const claims = res.claims()
      if (!claims) throw new Error('no ID token in the token response')
      const sub = claims.sub
      const email = typeof claims.email === 'string' ? claims.email : undefined
      if (o.access.mode === 'owner') {
        const allowed = o.access.allowedAccountId ?? registration.ownerSub
        if (!allowed && o.access.claimOwner)
          await o.store.saveRegistration({ ...registration, ownerSub: sub })
        else if (!allowed || sub !== allowed) {
          if (res.refresh_token) await revoke(clientId, res.refresh_token)
          throw new AccountRefusedError(sub, allowed ? 'owner' : 'unset')
        }
      } else if (o.access.allowedEmails?.length) {
        const normalized = email?.toLowerCase()
        const matches =
          normalized &&
          o.access.allowedEmails.some((entry) => {
            const value = entry.trim().toLowerCase()
            return value.startsWith('@')
              ? normalized.slice(normalized.lastIndexOf('@')) === value
              : normalized === value
          })
        if (claims.email_verified !== true || !matches) {
          if (res.refresh_token) await revoke(clientId, res.refresh_token)
          throw new AccountRefusedError(sub, 'email', email)
        }
      }
      await o.store.saveTokens({
        issuer,
        sub,
        ...(email && { email }),
        clientId,
        hostId: registration.hostId,
        ...(res.id_token && { idToken: res.id_token }),
        accessToken: res.access_token,
        ...(res.refresh_token && { refreshToken: res.refresh_token }),
        tokenType: res.token_type ?? 'bearer',
        expiresAt: now() + (res.expires_in ?? 3600) * 1000,
        scope: res.scope ?? '',
        savedAt: now(),
      })
      return {
        sub,
        ...(email && { email }),
        ...(p.next && { next: safeNext(p.next) }),
      }
    },

    async getPlanToken(sub) {
      // Lock before loading: no caller can refresh a stale snapshot after a sibling rotates it.
      let task = refreshing.get(sub)
      if (!task) {
        task = (async () => {
          const t = await o.store.loadTokens(sub)
          if (!t) throw new SigninRequiredError()
          if (!t.scope.split(/\s+/).includes(PLAN_SCOPE))
            throw new SigninRequiredError(
              'ChatGPT plan usage was not granted; sign in again and allow it',
            )
          if (t.expiresAt - now() > REFRESH_WINDOW_MS) return t.accessToken
          return refresh(t)
        })().finally(() => {
          refreshing.delete(sub)
        })
        refreshing.set(sub, task)
      }
      return task
    },

    async logout(sub) {
      await refreshing.get(sub)?.catch(() => undefined)
      const t = await o.store.loadTokens(sub).catch(() => undefined)
      await o.store.clearTokens(sub)
      const revoked = t?.refreshToken
        ? await revoke(t.clientId, t.refreshToken)
        : false
      return { revoked }
    },

    async status(sub) {
      const t = await o.store.loadTokens(sub).catch(() => undefined)
      const clientId =
        o.access.mode === 'owner' ? await savedClientId() : undefined
      if (!t)
        return {
          signedIn: false,
          planUsage: false,
          ...(clientId && { clientId }),
        }
      return {
        signedIn: true,
        sub: t.sub,
        ...(t.email && { email: t.email }),
        planUsage: t.scope.split(/\s+/).includes(PLAN_SCOPE),
        expiresAt: t.expiresAt,
        clientId: t.clientId,
      }
    },
  }
}

/** Only same-origin absolute paths may survive the OAuth round trip. */
function safeNext(value: string): string {
  return value.startsWith('/') &&
    !value.startsWith('//') &&
    !/[\\\x00-\x20\x7f]/.test(value)
    ? value
    : '/'
}
