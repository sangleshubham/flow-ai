import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

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
    const key = await fixtureKey({ role: 'planner', promptVersion: '1.0.0', model: 'gpt-6.1-sol', prefix: 'P', body: 'B' })
    await mkdir(join(dir, 'planner'))
    await writeFile(
      join(dir, 'planner', `${key}.json`),
      JSON.stringify({ key, source: 'handwritten', role: 'planner', promptVersion: '1.0.0', model: 'gpt-6.1-sol', effort: 'medium', schemaName: 'VisualPlan', data: plan }),
    )
    const s = await createIllusServer({ ILLUS_SESSION_SECRET: SECRET, ILLUS_FIXTURES_DIR: dir }, { prompts })
    expect(s.mode).toBe('replay')
    expect(s.auth).toBeUndefined()
    const res = await s.gateway.handle({ ...make.llmRequest(), prefix: 'P', body: 'B', requestId: 'x' }, { session: true })
    expect(res.body).toMatchObject({ ok: true, data: plan })
  })

  it('validates configuration up front', async () => {
    const base = { ILLUS_SESSION_SECRET: SECRET }
    await expect(createIllusServer({ ...base, ILLUS_MODELS_JSON: '{"efforts":{"planner":"xhigh"}}' }, { prompts })).rejects.toThrow(/not allowed in v1/)
    await expect(createIllusServer({ ...base, ILLUS_LLM_MODE: 'live' }, { prompts })).rejects.toThrow(/ILLUS_DATA_DIR/)
    const data = await mkdtemp(join(tmpdir(), 'illus-data-'))
    await expect(createIllusServer({ ...base, ILLUS_LLM_MODE: 'live', ILLUS_DATA_DIR: data }, { prompts })).rejects.toThrow(/ILLUS_TOKEN_ENC_KEY/)
    await expect(
      createIllusServer({ ...base, ILLUS_LLM_MODE: 'live', ILLUS_DATA_DIR: data, ILLUS_LLM_PROVIDER: 'openai-api-key' }, { prompts }),
    ).rejects.toThrow(/ILLUS_OPENAI_API_KEY/)
    const api = await createIllusServer(
      { ...base, ILLUS_LLM_MODE: 'live', ILLUS_DATA_DIR: data, ILLUS_LLM_PROVIDER: 'openai-api-key', ILLUS_OPENAI_API_KEY: 'sk-test' },
      { prompts },
    )
    expect(api.provider).toBe('openai-api-key')
    const plan = await createIllusServer(
      { ...base, ILLUS_LLM_MODE: 'live', ILLUS_DATA_DIR: data, ILLUS_TOKEN_ENC_KEY: Buffer.alloc(32).toString('base64'), ILLUS_PUBLIC_URL: 'http://127.0.0.1:3000', ILLUS_MAX_REQUESTS_5H: '20' },
      { prompts },
    )
    expect(plan.provider).toBe('chatgpt-plan')
    expect(plan.usage.summary()).toMatchObject({ max5h: 20, maxDay: 300 })
    expect(plan.pasteSignin).toBe(false)
    // Signed out: the plan provider answers signin-required, never a paid fallback.
    expect(await plan.gateway.handle({ ...make.llmRequest(), requestId: 'y' }, { session: true })).toMatchObject({ body: { code: 'signin-required' } })
  })

  it('needs no ILLUS_PUBLIC_URL for sign-in; a non-loopback URL selects paste sign-in (ADR 0047)', async () => {
    const data = await mkdtemp(join(tmpdir(), 'illus-data-'))
    const env = { ILLUS_SESSION_SECRET: SECRET, ILLUS_LLM_MODE: 'live', ILLUS_DATA_DIR: data, ILLUS_TOKEN_ENC_KEY: Buffer.alloc(32).toString('base64') }
    const local = await createIllusServer(env, { prompts })
    expect(local.auth).toBeDefined()
    expect(local.pasteSignin).toBe(false)
    const remote = await createIllusServer({ ...env, ILLUS_PUBLIC_URL: 'https://reader.example.com' }, { prompts })
    expect(remote.pasteSignin).toBe(true)
  })
})
