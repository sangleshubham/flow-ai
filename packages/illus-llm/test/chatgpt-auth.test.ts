import { mkdtemp, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  AccountRefusedError,
  PASTE_REDIRECT_URI,
  SigninRequiredError,
  createChatGptAuth,
  createSessions,
  createTokenStore,
  openReaderDb,
  parseEncKey,
  seal,
  unseal,
} from '../src/server/index.ts'
import { createFakeOidc } from './fake-oidc.ts'

const KEY = parseEncKey(Buffer.alloc(32, 7).toString('base64'))

async function setup(
  o: {
    allowed?: string | null
    grantScope?: string
    claimOwner?: boolean
    redirectUri?: string
    sub?: string
  } = {},
) {
  // openid-client checks ID-token times against the real clock, so the test clock starts now.
  let t = Date.now()
  const oidc = createFakeOidc({
    now: () => t,
    ...(o.grantScope && { grantScope: o.grantScope }),
    ...(o.sub && { sub: o.sub }),
  })
  const dir = await mkdtemp(join(tmpdir(), 'illus-auth-'))
  const db = openReaderDb({ dir })
  const store = createTokenStore({ db, dir, key: KEY })
  const auth = createChatGptAuth({
    store,
    key: KEY,
    publicUrl: 'http://127.0.0.1:3000',
    access: {
      mode: 'owner',
      ...(o.allowed !== null && { allowedAccountId: o.allowed ?? 'user-abc' }),
      ...(o.claimOwner && { claimOwner: true }),
    },
    ...(o.redirectUri && { redirectUri: o.redirectUri }),
    issuer: oidc.issuer,
    fetch: oidc.fetch,
    now: () => t,
  })
  const signIn = async () => {
    const { url, pending } = await auth.start()
    return auth.callback(oidc.consent(url), pending)
  }
  return {
    oidc,
    dir,
    db,
    store,
    auth,
    signIn,
    advance: (ms: number) => (t += ms),
  }
}

describe('Sign in with ChatGPT', () => {
  it('start builds the PKCE authorization request with the plan-usage parameters', async () => {
    const { auth, store } = await setup()
    const { url } = await auth.start()
    const q = new URL(url).searchParams
    expect(url.startsWith('https://auth.test/api/accounts/authorize?')).toBe(
      true,
    )
    expect(Object.fromEntries(q)).toMatchObject({
      client_id: 'dynamic_agent_client',
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:3000/auth/chatgpt/callback',
      scope:
        'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      resource: 'https://api.openai.com/v1',
      code_challenge_method: 'S256',
      agent_name_hint: 'AI Illustrated Reader',
      ext_agent_host_id: (await store.loadRegistration()).hostId,
    })
    expect(q.get('ext_agent_host_id')).toMatch(/^urn:uuid:[0-9a-f-]{36}$/)
    for (const k of ['state', 'nonce', 'code_challenge'])
      expect(q.get(k)).toBeTruthy()
  })

  it('callback registers the issued client, verifies the ID token and stores tokens encrypted', async () => {
    const { auth, signIn, dir, db, store, oidc } = await setup()
    expect(await signIn()).toEqual({
      sub: 'user-abc',
      email: 'shubham@example.com',
    })
    expect((await store.loadRegistration()).clientId).toBe('oaiapp_test123')
    expect(oidc.state.tokenRequests[0]).toMatchObject({
      grant_type: 'authorization_code',
      client_id: 'oaiapp_test123',
      resource: 'https://api.openai.com/v1',
    })
    expect(await auth.status('user-abc')).toMatchObject({
      signedIn: true,
      sub: 'user-abc',
      planUsage: true,
      clientId: 'oaiapp_test123',
    })
    // At rest: encrypted, owner-only.
    const raw = String(
      db.prepare('SELECT sealed FROM chatgpt_tokens').get()!.sealed,
    )
    expect(raw).not.toMatch(/at_|rt_|user-abc/)
    expect((await stat(join(dir, 'reader.db'))).mode & 0o777).toBe(0o600)
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([])
    // Second sign-in reuses the issued client and sends id_token_hint, no agent_name_hint.
    const q = new URL((await auth.start({ sub: 'user-abc' })).url).searchParams
    expect(q.get('client_id')).toBe('oaiapp_test123')
    expect(q.get('agent_name_hint')).toBeNull()
    expect(q.get('id_token_hint')).toBeTruthy()
  })

  it('rejects a wrong state, a missing pending cookie, an expired attempt and a bad nonce', async () => {
    const { auth, oidc, advance } = await setup()
    const a = await auth.start()
    const params = oidc.consent(a.url)
    params.set('state', 'forged')
    await expect(auth.callback(params, a.pending)).rejects.toThrow(
      /state mismatch/,
    )
    await expect(auth.callback(oidc.consent(a.url), undefined)).rejects.toThrow(
      /no sign-in in progress/,
    )
    const b = await auth.start()
    advance(11 * 60_000)
    await expect(auth.callback(oidc.consent(b.url), b.pending)).rejects.toThrow(
      /too long/,
    )
    const c = await auth.start()
    oidc.state.forceNonce = 'other'
    await expect(
      auth.callback(oidc.consent(c.url), c.pending),
    ).rejects.toThrow()
    expect(await auth.status('user-abc')).toMatchObject({ signedIn: false })
  })

  it('refuses any account other than ILLUS_ALLOWED_ACCOUNT_ID and revokes its tokens', async () => {
    const { signIn, auth, oidc } = await setup({ allowed: 'someone-else' })
    const err = await signIn().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AccountRefusedError)
    expect(oidc.state.revoked).toHaveLength(1)
    expect(await auth.status('user-abc')).toMatchObject({ signedIn: false })
    const unset = await setup({ allowed: null })
    await expect(unset.signIn()).rejects.toThrow(/Set it to user-abc/)
  })

  it('with claimOwner, the first account to sign in becomes the owner and others are refused (ADR 0047)', async () => {
    const { signIn, store, dir, db, oidc } = await setup({
      allowed: null,
      claimOwner: true,
    })
    expect(await signIn()).toMatchObject({ sub: 'user-abc' })
    expect(await store.loadRegistration()).toMatchObject({
      ownerSub: 'user-abc',
      clientId: 'oaiapp_test123',
    })
    expect(await signIn()).toMatchObject({ sub: 'user-abc' }) // the owner signs in again
    // A second reader on the same data directory, reached by another account.
    const other = createChatGptAuth({
      store,
      key: KEY,
      publicUrl: 'http://127.0.0.1:3000',
      access: { mode: 'owner', claimOwner: true },
      issuer: oidc.issuer,
      fetch: oidc.fetch,
    })
    oidc.state.sub = 'intruder'
    const { url, pending } = await other.start()
    const err = await other
      .callback(oidc.consent(url), pending)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AccountRefusedError)
    expect((await store.loadRegistration()).ownerSub).toBe('user-abc')
    expect(
      (await createTokenStore({ db, dir, key: KEY }).loadTokens('user-abc'))
        ?.sub,
    ).toBe('user-abc')
  })

  it('an explicit ILLUS_ALLOWED_ACCOUNT_ID wins over claiming', async () => {
    const { signIn, store } = await setup({
      allowed: 'someone-else',
      claimOwner: true,
    })
    await expect(signIn()).rejects.toBeInstanceOf(AccountRefusedError)
    expect((await store.loadRegistration()).ownerSub).toBeUndefined()
  })

  it('a remote reader sends the paste redirect URI and completes with the pasted parameters', async () => {
    const { auth, oidc, store } = await setup({
      redirectUri: PASTE_REDIRECT_URI,
    })
    expect(PASTE_REDIRECT_URI).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/auth\/chatgpt\/callback$/,
    )
    const { url, pending } = await auth.start()
    expect(new URL(url).searchParams.get('redirect_uri')).toBe(
      PASTE_REDIRECT_URI,
    )
    const pasted = new URL(PASTE_REDIRECT_URI)
    for (const [k, v] of oidc.consent(url)) pasted.searchParams.append(k, v)
    expect(
      await auth.callback(new URL(pasted.href).searchParams, pending),
    ).toMatchObject({ sub: 'user-abc' })
    expect(oidc.state.tokenRequests[0]).toMatchObject({
      redirect_uri: PASTE_REDIRECT_URI,
    })
    expect((await store.loadTokens('user-abc'))?.sub).toBe('user-abc')
  })

  it('getPlanToken returns the token, refreshes within 5 minutes of expiry, and serializes refreshes', async () => {
    const { auth, signIn, advance, oidc } = await setup()
    await expect(auth.getPlanToken('user-abc')).rejects.toBeInstanceOf(
      SigninRequiredError,
    )
    await signIn()
    const first = await auth.getPlanToken('user-abc')
    advance(54 * 60_000) // 6 minutes left: no refresh
    expect(await auth.getPlanToken('user-abc')).toBe(first)
    advance(2 * 60_000) // 4 minutes left: refresh
    const [a, b] = await Promise.all([
      auth.getPlanToken('user-abc'),
      auth.getPlanToken('user-abc'),
    ])
    expect(a).not.toBe(first)
    expect(b).toBe(a)
    const refreshes = oidc.state.tokenRequests.filter(
      (r) => r.grant_type === 'refresh_token',
    )
    expect(refreshes).toHaveLength(1)
    expect(refreshes[0]).toMatchObject({
      client_id: 'oaiapp_test123',
      resource: 'https://api.openai.com/v1',
    })
    expect(refreshes[0]).not.toHaveProperty('scope')
    // The rotated refresh token is used next time.
    advance(58 * 60_000)
    expect(await auth.getPlanToken('user-abc')).not.toBe(a)
  })

  it('a terminal refresh error clears tokens (signin-required); a 5xx keeps them', async () => {
    const { auth, signIn, advance, oidc } = await setup()
    await signIn()
    advance(57 * 60_000)
    oidc.state.failNextRefresh = 'server_error'
    await expect(auth.getPlanToken('user-abc')).rejects.not.toBeInstanceOf(
      SigninRequiredError,
    )
    expect((await auth.status('user-abc')).signedIn).toBe(true)
    oidc.state.failNextRefresh = 'invalid_grant'
    await expect(auth.getPlanToken('user-abc')).rejects.toBeInstanceOf(
      SigninRequiredError,
    )
    expect((await auth.status('user-abc')).signedIn).toBe(false)
  })

  it('without the plan scope, inference is refused with signin-required', async () => {
    const { auth, signIn } = await setup({
      grantScope: 'openid profile email offline_access',
    })
    await signIn()
    expect(await auth.status('user-abc')).toMatchObject({
      signedIn: true,
      planUsage: false,
    })
    await expect(auth.getPlanToken('user-abc')).rejects.toThrow(
      /plan usage was not granted/,
    )
  })

  it('logout revokes the refresh token and clears tokens but keeps the registration', async () => {
    const { auth, signIn, oidc, store } = await setup()
    await signIn()
    expect(await auth.logout('user-abc')).toEqual({ revoked: true })
    expect(oidc.state.revoked).toHaveLength(1)
    expect(await auth.status('user-abc')).toMatchObject({
      signedIn: false,
      clientId: 'oaiapp_test123',
    })
    expect((await store.loadRegistration()).clientId).toBe('oaiapp_test123')
  })
})

describe('crypto and sessions', () => {
  it('seal/unseal binds purpose and key', () => {
    const s = seal(KEY, 'secret', 'a')
    expect(unseal(KEY, s, 'a')).toBe('secret')
    expect(() => unseal(KEY, s, 'b')).toThrow()
    expect(() => unseal(parseEncKey('0'.repeat(64)), s, 'a')).toThrow()
    expect(() => parseEncKey('short')).toThrow(/32 bytes/)
  })

  it('issueSession / verify: signed, expiring, tamper-proof', () => {
    let t = 1_000_000_000_000
    const db = openReaderDb({ memory: true })
    const s = createSessions({
      db,
      secret: 'x'.repeat(32),
      secure: false,
      now: () => t,
    })
    const cookie = s.issueSession({ sub: 'user-abc', email: 'e@x' })
    expect(cookie).toMatch(
      /^illus_session=.+; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/,
    )
    const header = `other=1; ${cookie.split(';')[0]}`
    expect(s.verify(header)).toMatchObject({ sub: 'user-abc', email: 'e@x' })
    expect(s.verify(header.replace(/\.(.)/, '.X$1'))).toBeNull()
    expect(
      createSessions({ db, secret: 'y'.repeat(32), secure: true }).verify(
        header,
      ),
    ).toBeNull()
    t += 31 * 24 * 3600 * 1000
    expect(s.verify(header)).toBeNull()
    expect(() =>
      createSessions({ db, secret: 'short', secure: false }),
    ).toThrow(/32 characters/)
    expect(
      createSessions({ db, secret: 'x'.repeat(32), secure: true }).issueSession(
        { sub: 'a' },
      ),
    ).toContain('; Secure')
  })
})

async function openSetup(allowedEmails?: string[]) {
  let t = Date.now()
  const oidc = createFakeOidc({ now: () => t })
  const db = openReaderDb({ memory: true })
  const dir = await mkdtemp(join(tmpdir(), 'illus-open-auth-'))
  const store = createTokenStore({ db, dir, key: KEY })
  const auth = createChatGptAuth({
    store,
    key: KEY,
    publicUrl: 'http://127.0.0.1:3000',
    access: { mode: 'open', ...(allowedEmails && { allowedEmails }) },
    issuer: oidc.issuer,
    fetch: oidc.fetch,
    now: () => t,
  })
  const signIn = async () => {
    const { url, pending } = await auth.start()
    return auth.callback(oidc.consent(url), pending)
  }
  return {
    auth,
    oidc,
    store,
    signIn,
    advance: () => {
      t += 57 * 60_000
    },
  }
}

it('keeps two accounts, their refresh locks, terminal errors and logout isolated', async () => {
  const { auth, oidc, store, signIn, advance } = await openSetup()
  await signIn()
  oidc.state.sub = 'B'
  oidc.state.email = 'b@example.com'
  await signIn()
  const b = await store.loadTokens('B')
  expect(await auth.getPlanToken('B')).toBe(b!.accessToken)
  expect(await auth.getPlanToken('user-abc')).not.toBe(b!.accessToken)
  advance()
  const refreshed = await Promise.all(
    Array.from({ length: 5 }, () => auth.getPlanToken('user-abc')),
  )
  expect(new Set(refreshed).size).toBe(1)
  expect(
    oidc.state.tokenRequests.filter((r) => r.grant_type === 'refresh_token'),
  ).toHaveLength(1)
  expect(await store.loadTokens('B')).toEqual(b)
  advance()
  oidc.state.failNextRefresh = 'invalid_grant'
  await expect(auth.getPlanToken('user-abc')).rejects.toBeInstanceOf(
    SigninRequiredError,
  )
  expect(await store.loadTokens('B')).toEqual(b)
  oidc.state.sub = 'user-abc'
  await signIn()
  const a = await store.loadTokens('user-abc')
  await auth.logout('B')
  expect(await store.loadTokens('B')).toBeUndefined()
  expect(await store.loadTokens('user-abc')).toEqual(a)
})

it.each([
  ['shubham@example.com', true, ['shubham@example.com'], true],
  ['SHUBHAM@EXAMPLE.COM', true, ['shubham@example.com'], true],
  ['a@example.com', true, ['@example.com'], true],
  ['a@badexample.com', true, ['@example.com'], false],
  ['stranger@elsewhere.com', true, ['@example.com'], false],
  ['shubham@example.com', false, ['shubham@example.com'], false],
] as const)(
  'allowlist: %s verified=%s',
  async (email, verified, entries, allowed) => {
    const { auth, oidc, signIn } = await openSetup([...entries])
    oidc.state.email = email
    oidc.state.emailVerified = verified
    if (allowed) expect(await signIn()).toMatchObject({ email })
    else {
      await expect(signIn()).rejects.toMatchObject({ reason: 'email' })
      expect(oidc.state.revoked).toHaveLength(1)
      expect((await auth.status('user-abc')).signedIn).toBe(false)
    }
  },
)

it('uses dynamic registration for a new visitor and the saved client only for a known account', async () => {
  const { auth, signIn } = await openSetup()
  await signIn()
  const fresh = new URL((await auth.start()).url).searchParams
  expect(fresh.get('client_id')).toBe('dynamic_agent_client')
  expect(fresh.has('id_token_hint')).toBe(false)
  const returning = new URL((await auth.start({ sub: 'user-abc' })).url)
    .searchParams
  expect(returning.get('client_id')).toBe('oaiapp_test123')
  expect(returning.get('id_token_hint')).toBeTruthy()
})

it('carries a safe return path in sealed pending state and drops external paths', async () => {
  const { auth, oidc } = await openSetup()
  for (const [next, expected] of [
    ['/library?tab=1', '/library?tab=1'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/\n/evil.example', '/'],
  ]) {
    const start = await auth.start({ next })
    expect(
      await auth.callback(oidc.consent(start.url), start.pending),
    ).toMatchObject({ next: expected })
  }
})
