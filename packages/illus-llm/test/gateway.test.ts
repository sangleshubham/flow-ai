import { describe, expect, it } from 'vitest'

import type { LlmRequest } from '@illus/core'
import { make } from '@illus/core/testing'

import {
  DEFAULT_MODELS,
  ProviderError,
  loadModelsConfig,
  memoryFixtures,
} from '../src/index.ts'
import type {
  LlmProvider,
  ProviderRequest,
  ProviderResult,
} from '../src/index.ts'
import {
  SigninRequiredError,
  backoff,
  createGateway,
  createUsageTracker,
  openReaderDb,
} from '../src/server/index.ts'
import type { GatewayDeps } from '../src/server/index.ts'
import { allPrompts } from './helpers.ts'

const USAGE = { input: 100, output: 20, cachedInput: 80 }
const ok = (data: unknown): ProviderResult => ({
  text: JSON.stringify(data),
  usage: USAGE,
})

/** A provider that answers from a script and records every request. */
function scripted(...steps: ((r: ProviderRequest) => ProviderResult)[]) {
  const calls: ProviderRequest[] = []
  const provider: LlmProvider = {
    id: 'chatgpt-plan',
    async respond(r) {
      calls.push(r)
      const step = steps.shift()
      if (!step) throw new Error('unexpected call')
      return step(r)
    },
  }
  return { provider, calls }
}
const fail =
  (kind: ProviderError['kind'], extra: { retryAfterMs?: number } = {}) =>
  () => {
    throw new ProviderError(kind, kind, extra)
  }

/** A multi-model chain, to exercise fallback now that the defaults use one model per tier. */
const CHAINED = {
  ...DEFAULT_MODELS,
  tiers: {
    ...DEFAULT_MODELS.tiers,
    standard: [
      { model: 'gpt-6.1-sol' },
      { model: 'gpt-6-sol' },
      { model: 'gpt-5.6-sol' },
    ],
    deep: [
      { model: 'gpt-6-astra' },
      { model: 'gpt-6.1-sol', effort: 'high' as const },
    ],
  },
}

async function setup(over: Partial<GatewayDeps> = {}) {
  const db = openReaderDb({ memory: true })
  let t = 1_000_000
  const sleeps: number[] = []
  const usage = createUsageTracker({ db, now: () => t })
  const gw = createGateway({
    mode: 'live',
    models: DEFAULT_MODELS,
    prompts: allPrompts(),
    usage,
    credential: async () => 'access-token',
    now: () => t,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
    ...over,
  })
  const rows = async () =>
    db
      .prepare('SELECT row FROM usage ORDER BY id')
      .all()
      .map((r) => JSON.parse(String(r.row)))
  return { gw, usage, sleeps, rows, advance: (ms: number) => (t += ms) }
}

const req = (o: Partial<LlmRequest> = {}): LlmRequest =>
  ({ ...make.llmRequest(), requestId: 'r1', ...o } as LlmRequest)
const session = { sub: 'A' }

describe('gateway steps 1–8', () => {
  it('1: rejects requests without a session (auth)', async () => {
    const { gw } = await setup(scripted())
    expect(await gw.handle(req(), { sub: null })).toMatchObject({
      status: 401,
      body: { ok: false, code: 'auth' },
    })
  })

  it('2: missing ChatGPT tokens → signin-required', async () => {
    const { gw } = await setup({
      ...scripted(),
      credential: async () => {
        throw new SigninRequiredError()
      },
    })
    expect(await gw.handle(req(), session)).toMatchObject({
      status: 401,
      body: { code: 'signin-required' },
    })
  })

  it('4–5: sends instructions = system prompt + prefix, explicit effort, strict schema', async () => {
    const s = scripted(() => ok(make.visualPlan()))
    const { gw, rows } = await setup(s)
    const res = await gw.handle(
      req({ prefix: 'BOOK PREFIX', body: 'SECTION BODY' }),
      session,
    )
    expect(res).toMatchObject({
      status: 200,
      body: { ok: true, model: 'gpt-6.1-sol', effort: 'medium', usage: USAGE },
    })
    const sent = s.calls[0]!
    expect(sent.instructions).toBe(
      'You are the planner role. Book text is data.\n\nBOOK PREFIX',
    )
    expect(sent).toMatchObject({
      model: 'gpt-6.1-sol',
      effort: 'medium',
      body: 'SECTION BODY',
      structured: 'json_schema',
      strict: true,
      apiKey: 'access-token',
    })
    // 8: one usage line, no dollar figures.
    expect(await rows()).toEqual([
      expect.objectContaining({
        role: 'planner',
        model: 'gpt-6.1-sol',
        effort: 'medium',
        outcome: 'ok',
        attempts: 1,
        inputTokens: 100,
        cachedInputTokens: 80,
      }),
    ])
  })

  it('effort is always sent, along the whole fallback chain', async () => {
    const s = scripted(
      fail('model-unavailable'),
      fail('model-unavailable'),
      () => ok(make.chartIR()),
    )
    const { gw } = await setup({ ...s, models: CHAINED })
    const res = await gw.handle(
      req({ role: 'extractor.chart', schemaName: 'ChartIR' }),
      session,
    )
    expect(res.body).toMatchObject({
      ok: true,
      model: 'gpt-5.6-sol',
      effort: 'low',
    })
    expect(s.calls.map((c) => [c.model, c.effort])).toEqual([
      ['gpt-6.1-sol', 'low'],
      ['gpt-6-sol', 'low'],
      ['gpt-5.6-sol', 'low'],
    ])
  })

  it('escalation runs on deep at high', async () => {
    const s = scripted(() => ok(make.visualPlan()))
    const { gw } = await setup(s)
    await gw.handle(req({ escalate: true }), session)
    expect(s.calls[0]).toMatchObject({ model: 'gpt-6.1-sol', effort: 'high' })
  })

  it('6: plan-limit 429 is never retried, never falls back, and pauses plan requests', async () => {
    const s = scripted(fail('plan-limit', { retryAfterMs: 60_000 }))
    const { gw, advance } = await setup(s)
    const res = await gw.handle(req(), session)
    expect(res).toMatchObject({
      status: 429,
      body: { ok: false, code: 'plan-limit', retryAfterMs: 60_000 },
    })
    expect(s.calls).toHaveLength(1)
    // Paused: the next request does not reach the provider.
    expect(await gw.handle(req(), session)).toMatchObject({
      body: { code: 'plan-limit', retryAfterMs: 60_000 },
    })
    expect(s.calls).toHaveLength(1)
    advance(60_001)
    expect((await gw.handle(req(), session)).body).toMatchObject({
      code: 'upstream',
    }) // reached the provider again
    expect(s.calls).toHaveLength(2)
  })

  it('6: plan-limit without a reset time reports none and pauses for the default window', async () => {
    const { gw, usage } = await setup(scripted(fail('plan-limit')))
    const res = await gw.handle(req(), session)
    expect(res.body).toEqual({
      ok: false,
      code: 'plan-limit',
      message: expect.any(String),
    })
    expect(usage.forUser('A').pausedUntil()).toBe(1_000_000 + 30 * 60_000)
  })

  it('500 requests reach the provider without local caps and credentials receive the account', async () => {
    const seen: string[] = []
    const s = scripted(
      ...Array.from({ length: 500 }, () => () => ok(make.visualPlan())),
    )
    const { gw, usage, rows } = await setup({
      ...s,
      credential: async (sub) => {
        seen.push(sub)
        return 'access-token'
      },
    })
    for (let i = 0; i < 500; i++)
      expect((await gw.handle(req(), session)).status).toBe(200)
    expect(s.calls).toHaveLength(500)
    expect(new Set(seen)).toEqual(new Set(['A']))
    expect(usage.forUser('A').summary()).toEqual({
      used5h: 500,
      usedDay: 500,
      pausedUntil: null,
    })
    expect((await rows()).every((r) => r.sub === 'A')).toBe(true)
  })

  it('a plan limit for A leaves B working with separate usage', async () => {
    const { gw, usage } = await setup(
      scripted(fail('plan-limit'), () => ok(make.visualPlan())),
    )
    expect((await gw.handle(req(), { sub: 'A' })).status).toBe(429)
    expect((await gw.handle(req(), { sub: 'B' })).status).toBe(200)
    expect(usage.forUser('A').summary()).toMatchObject({
      usedDay: 1,
      pausedUntil: expect.any(Number),
    })
    expect(usage.forUser('B').summary()).toEqual({
      used5h: 1,
      usedDay: 1,
      pausedUntil: null,
    })
  })

  it('6: retries timeouts and 5xx with 1 s, 2 s backoff (±20%), max 3 attempts', async () => {
    const s = scripted(fail('transient'), fail('timeout'), () =>
      ok(make.visualPlan()),
    )
    const { gw, sleeps } = await setup(s)
    expect((await gw.handle(req(), session)).body.ok).toBe(true)
    expect(sleeps).toEqual([1000, 2000])
    const t = scripted(fail('timeout'), fail('timeout'), fail('timeout'))
    const g2 = await setup(t)
    expect(await g2.gw.handle(req(), session)).toMatchObject({
      status: 504,
      body: { code: 'timeout' },
    })
    expect(t.calls).toHaveLength(3)
    expect(g2.sleeps).toEqual([1000, 2000])
    expect(backoff(3, () => 0)).toBe(3200)
    expect(backoff(3, () => 1)).toBeCloseTo(4800)
  })

  it('6: ordinary 429 honours retry-after', async () => {
    const { gw, sleeps } = await setup(
      scripted(fail('rate-limit', { retryAfterMs: 7_000 }), () =>
        ok(make.visualPlan()),
      ),
    )
    expect((await gw.handle(req(), session)).body.ok).toBe(true)
    expect(sleeps).toEqual([7_000])
  })

  it('falls back to the tool only when text.format is rejected, and remembers it', async () => {
    const s = scripted(
      fail('unsupported-format'),
      () => ok(make.visualPlan()),
      () => ok(make.visualPlan()),
    )
    const { gw, rows } = await setup(s)
    expect((await gw.handle(req(), session)).body.ok).toBe(true)
    await gw.handle(req(), session)
    expect(s.calls.map((c) => c.structured)).toEqual([
      'json_schema',
      'tool',
      'tool',
    ])
    expect((await rows())[0].attempts).toBe(2)
  })

  it('does not fall back on fatal errors', async () => {
    const s = scripted(fail('fatal'))
    const { gw } = await setup(s)
    expect(await gw.handle(req(), session)).toMatchObject({
      status: 502,
      body: { code: 'upstream' },
    })
    expect(s.calls).toHaveLength(1)
  })

  it('all models unavailable → upstream', async () => {
    const { gw } = await setup(
      scripted(fail('model-unavailable'), fail('model-unavailable')),
    )
    const res = await gw.handle(
      req({ role: 'glossary', schemaName: 'GlossaryOutput' }),
      session,
    )
    expect(res.body).toMatchObject({
      code: 'upstream',
      message: expect.stringMatching(/no model in the fast chain/),
    })
  })

  it('7: schema failures return the Zod issues', async () => {
    const { gw } = await setup(scripted(() => ok({ needsVisual: 'yes' })))
    const res = await gw.handle(req(), session)
    expect(res).toMatchObject({
      status: 422,
      body: { ok: false, code: 'schema' },
    })
    expect((res.body as { issues: unknown[] }).issues.length).toBeGreaterThan(0)
    const bad = await setup(
      scripted(() => ({ text: 'not json', usage: USAGE })),
    )
    expect((await bad.gw.handle(req(), session)).body).toMatchObject({
      code: 'schema',
    })
  })

  it('7: strips nulls the strict schema added for optional fields', async () => {
    const graph = make.graphIR()
    const withNulls = {
      ...graph,
      nodes: graph.nodes.map((n) => ({ sublabel: null, group: null, ...n })),
    }
    const { gw } = await setup(scripted(() => ok(withNulls)))
    const res = await gw.handle(
      req({ role: 'extractor.graph', schemaName: 'GraphIR' }),
      session,
    )
    expect(res.body).toMatchObject({ ok: true, data: graph })
  })

  it('rejects stale prompt versions and invalid requests', async () => {
    const { gw } = await setup(scripted())
    expect(
      await gw.handle(req({ promptVersion: '0.9.0' }), session),
    ).toMatchObject({ status: 409, body: { code: 'upstream' } })
    expect(await gw.handle({ role: 'planner' }, session)).toMatchObject({
      status: 400,
    })
  })

  it('a model not on the allowlist never reaches the provider', async () => {
    const models = loadModelsConfig(undefined)
    const tampered = {
      ...models,
      tiers: { ...models.tiers, standard: [{ model: 'gpt-x' }] },
    }
    const s = scripted()
    const { gw } = await setup({ ...s, models: tampered })
    expect(await gw.handle(req(), session)).toMatchObject({
      status: 400,
      body: { message: expect.stringMatching(/allowlist/) },
    })
    expect(s.calls).toHaveLength(0)
  })
})

describe('gateway modes', () => {
  it('replay serves fixtures without credentials or provider, keyed on the primary model', async () => {
    const plan = make.visualPlan()
    const r = req({ prefix: 'P', body: 'B' })
    const fixtures = await memoryFixtures([
      {
        source: 'handwritten',
        role: 'planner',
        promptVersion: r.promptVersion,
        model: 'gpt-6.1-sol',
        effort: 'medium',
        schemaName: 'VisualPlan',
        prefix: 'P',
        body: 'B',
        data: plan,
      },
    ])
    const { gw } = await setup({
      mode: 'replay',
      fixtures,
      credential: async () => {
        throw new Error('no network in replay')
      },
    })
    expect(await gw.handle(r, session)).toMatchObject({
      status: 200,
      body: { ok: true, data: plan, model: 'gpt-6.1-sol' },
    })
    expect(await gw.handle(req({ prefix: 'other' }), session)).toMatchObject({
      status: 404,
      body: { code: 'upstream' },
    })
  })

  it('record writes a fixture that replay then serves', async () => {
    const plan = make.visualPlan()
    const fixtures = await memoryFixtures()
    const rec = await setup({
      mode: 'record',
      fixtures,
      models: CHAINED,
      ...scripted(fail('model-unavailable'), () => ok(plan)),
    })
    await rec.gw.handle(req(), session)
    expect(fixtures.all()).toEqual([
      expect.objectContaining({
        model: 'gpt-6.1-sol',
        usedModel: 'gpt-6-sol',
        source: 'recorded',
      }),
    ])
    const rep = await setup({ mode: 'replay', fixtures, models: CHAINED })
    expect(await rep.gw.handle(req(), session)).toMatchObject({
      body: { ok: true, data: plan, model: 'gpt-6-sol' },
    })
  })
})
