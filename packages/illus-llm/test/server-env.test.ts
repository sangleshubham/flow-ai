import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { make } from '@illus/core/testing'

import { fixtureKey } from '../src/index.ts'
import { createIllusServer } from '../src/server/index.ts'
import { allPrompts } from './helpers.ts'

const SECRET = 's'.repeat(32)
const prompts = allPrompts()

describe('createIllusServer (env, §9 table)', () => {
  it('replay is the default mode and serves fixtures from disk without credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'illus-fx-'))
    const plan = make.visualPlan()
    const key = await fixtureKey({
      role: 'planner',
      promptVersion: '1.0.0',
      model: 'gpt-6.1-sol',
      prefix: 'P',
      body: 'B',
    })
    await mkdir(join(dir, 'planner'))
    await writeFile(
      join(dir, 'planner', `${key}.json`),
      JSON.stringify({
        key,
        source: 'handwritten',
        role: 'planner',
        promptVersion: '1.0.0',
        model: 'gpt-6.1-sol',
        effort: 'medium',
        schemaName: 'VisualPlan',
        data: plan,
      }),
    )
    const s = await createIllusServer(
      { ILLUS_SESSION_SECRET: SECRET, ILLUS_FIXTURES_DIR: dir },
      { prompts },
    )
    expect(s.mode).toBe('replay')
    expect(s.auth).toBeUndefined()
    const res = await s.gateway.handle(
      { ...make.llmRequest(), prefix: 'P', body: 'B', requestId: 'x' },
      { sub: 'A' },
    )
    expect(res.body).toMatchObject({ ok: true, data: plan })
  })

  it('validates configuration up front', async () => {
    const base = { ILLUS_SESSION_SECRET: SECRET }
    await expect(
      createIllusServer(
        { ...base, ILLUS_MODELS_JSON: '{"efforts":{"planner":"xhigh"}}' },
        { prompts },
      ),
    ).rejects.toThrow(/not allowed in v1/)
    await expect(
      createIllusServer({ ...base, ILLUS_LLM_MODE: 'live' }, { prompts }),
    ).rejects.toThrow(/ILLUS_DATA_DIR/)
    const data = await mkdtemp(join(tmpdir(), 'illus-data-'))
    await expect(
      createIllusServer(
        { ...base, ILLUS_LLM_MODE: 'live', ILLUS_DATA_DIR: data },
        { prompts },
      ),
    ).rejects.toThrow(/ILLUS_TOKEN_ENC_KEY/)
    await expect(
      createIllusServer(
        {
          ...base,
          ILLUS_LLM_MODE: 'live',
          ILLUS_DATA_DIR: data,
          ILLUS_LLM_PROVIDER: 'openai-api-key',
        },
        { prompts },
      ),
    ).rejects.toThrow(/ILLUS_OPENAI_API_KEY/)
    const api = await createIllusServer(
      {
        ...base,
        ILLUS_LLM_MODE: 'live',
        ILLUS_DATA_DIR: data,
        ILLUS_LLM_PROVIDER: 'openai-api-key',
        ILLUS_OPENAI_API_KEY: 'sk-test',
      },
      { prompts },
    )
    expect(api.provider).toBe('openai-api-key')
    const plan = await createIllusServer(
      {
        ...base,
        ILLUS_LLM_MODE: 'live',
        ILLUS_DATA_DIR: data,
        ILLUS_TOKEN_ENC_KEY: Buffer.alloc(32).toString('base64'),
        ILLUS_PUBLIC_URL: 'http://127.0.0.1:3000',
        ILLUS_MAX_REQUESTS_5H: '20',
      },
      { prompts },
    )
    expect(plan.provider).toBe('chatgpt-plan')
    expect(plan.usage.forUser('A').summary()).toMatchObject({
      used5h: 0,
      usedDay: 0,
      pausedUntil: null,
    })
    expect(plan.pasteSignin).toBe(false)
    // Signed out: the plan provider answers signin-required, never a paid fallback.
    expect(
      await plan.gateway.handle(
        { ...make.llmRequest(), requestId: 'y' },
        { sub: 'A' },
      ),
    ).toMatchObject({ body: { code: 'signin-required' } })
  })

  it('needs no ILLUS_PUBLIC_URL for sign-in; a non-loopback URL selects paste sign-in (ADR 0047)', async () => {
    const data = await mkdtemp(join(tmpdir(), 'illus-data-'))
    const env = {
      ILLUS_SESSION_SECRET: SECRET,
      ILLUS_LLM_MODE: 'live',
      ILLUS_DATA_DIR: data,
      ILLUS_TOKEN_ENC_KEY: Buffer.alloc(32).toString('base64'),
    }
    const local = await createIllusServer(env, { prompts })
    expect(local.auth).toBeDefined()
    expect(local.pasteSignin).toBe(false)
    const remote = await createIllusServer(
      { ...env, ILLUS_PUBLIC_URL: 'https://reader.example.com' },
      { prompts },
    )
    expect(remote.pasteSignin).toBe(true)
  })
})

it('parses open/owner access and rejects invalid modes; old caps only warn', async () => {
  const data = await mkdtemp(join(tmpdir(), 'illus-env-'))
  const env = { ILLUS_SESSION_SECRET: SECRET, ILLUS_DATA_DIR: data }
  expect((await createIllusServer(env, { prompts })).access).toBe('open')
  expect(
    (await createIllusServer({ ...env, ILLUS_ACCESS: 'owner' }, { prompts }))
      .access,
  ).toBe('owner')
  await expect(
    createIllusServer({ ...env, ILLUS_ACCESS: 'typo' }, { prompts }),
  ).rejects.toThrow(/ILLUS_ACCESS/)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const server = await createIllusServer(
      { ...env, ILLUS_MAX_REQUESTS_5H: '1' },
      { prompts },
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ignored'))
    expect(server.usage.forUser('A').summary()).not.toHaveProperty('max5h')
  } finally {
    warn.mockRestore()
  }
})

it('trims, lowercases and ignores empty email allowlist entries', async () => {
  const { createFakeOidc } = await import('./fake-oidc.ts')
  const oidc = createFakeOidc()
  const data = await mkdtemp(join(tmpdir(), 'illus-emails-'))
  const server = await createIllusServer(
    {
      ILLUS_SESSION_SECRET: SECRET,
      ILLUS_DATA_DIR: data,
      ILLUS_TOKEN_ENC_KEY: Buffer.alloc(32).toString('base64'),
      ILLUS_CHATGPT_ISSUER: oidc.issuer,
      ILLUS_ALLOWED_EMAILS: ' , SHUBHAM@EXAMPLE.COM, @OTHER.ORG, ',
    },
    { prompts, fetch: oidc.fetch },
  )
  const auth = server.auth!
  const a = await auth.start()
  expect(await auth.callback(oidc.consent(a.url), a.pending)).toMatchObject({
    email: 'shubham@example.com',
  })
  oidc.state.email = 'visitor@other.org'
  const b = await auth.start()
  expect(await auth.callback(oidc.consent(b.url), b.pending)).toMatchObject({
    email: 'visitor@other.org',
  })
})
