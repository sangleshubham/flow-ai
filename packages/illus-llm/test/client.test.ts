import { describe, expect, expectTypeOf, it } from 'vitest'

import { LlmError, ROLES, RoleName } from '@illus/core'
import type { GraphIR, LlmResponse, VisualPlan } from '@illus/core'
import { createMemoryRepos, make } from '@illus/core/testing'

import {
  DEFAULT_MODELS,
  createLlmClient,
  fixtureKey,
  httpTransport,
  memoryFixtures,
  recordTransport,
  replayTransport,
  resolveRoute,
  transportFor,
} from '../src/index.ts'
import type { LlmTransport } from '../src/index.ts'
import { SAMPLE, allPrompts } from './helpers.ts'

const prompts = allPrompts()
const ctx = { prefix: '<book_context>Replicated Logs</book_context>', body: '<section id="s1">The leader accepts client requests</section>' }

/** A hand-written fixture for every role, as role owners will add under fixtures/llm/<role>/. */
async function fixturesForAllRoles() {
  return memoryFixtures(
    RoleName.options.map((role) => {
      const schemaName = ROLES[role].schemas[0]
      return {
        source: 'handwritten',
        role,
        promptVersion: '1.0.0',
        model: resolveRoute(DEFAULT_MODELS, role).chain[0]!.model,
        effort: resolveRoute(DEFAULT_MODELS, role).chain[0]!.effort,
        schemaName,
        prefix: ctx.prefix,
        body: ctx.body,
        data: SAMPLE[schemaName](),
      }
    }),
  )
}

describe('createLlmClient', () => {
  it('typed calls work for every role in replay mode', async () => {
    const fixtures = await fixturesForAllRoles()
    const llm = createLlmClient({ transport: transportFor('replay', { fixtures, models: DEFAULT_MODELS }), prompts })
    for (const role of RoleName.options) {
      const res = await llm.call(role, ctx)
      expect(res.data, role).toEqual(SAMPLE[ROLES[role].schemas[0]]())
      expect(res.promptVersion).toBe('1.0.0')
      expect(res.model).toBe(resolveRoute(DEFAULT_MODELS, role).chain[0]!.model)
    }
    const plan = await llm.call('planner', ctx)
    expectTypeOf(plan.data).toEqualTypeOf<VisualPlan>()
    const graph = await llm.call('extractor.graph', ctx)
    expectTypeOf(graph.data).toEqualTypeOf<GraphIR>()
  })

  it('replay misses say how to fix them and never touch the network', async () => {
    const llm = createLlmClient({ transport: replayTransport({ fixtures: await memoryFixtures(), models: DEFAULT_MODELS }), prompts })
    await expect(llm.call('planner', ctx)).rejects.toMatchObject({ code: 'upstream', message: expect.stringMatching(/no fixture for planner@1.0.0/) })
  })

  it('writes one llmLog row per call, prompts only with debugPrompts', async () => {
    const repos = createMemoryRepos()
    const fixtures = await fixturesForAllRoles()
    let debug = false
    const llm = createLlmClient({
      transport: replayTransport({ fixtures, models: DEFAULT_MODELS }),
      prompts,
      log: repos.llmLog,
      debugPrompts: () => debug,
      now: () => 1_000,
      newRequestId: () => 'req-1',
    })
    await llm.call('planner', ctx, { bookId: '0123456789abcdef', sectionId: 's1' })
    debug = true
    await llm.call('critic', { prefix: 'p', body: 'b' }).catch(() => undefined)
    const rows = await repos.llmLog.list()
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.role === 'planner')).toMatchObject({ outcome: 'ok', model: 'gpt-6.1-sol', effort: 'medium', bookId: '0123456789abcdef' })
    expect(rows.find((r) => r.role === 'planner')!.prompt).toBeUndefined()
    expect(rows.find((r) => r.role === 'critic')).toMatchObject({ outcome: 'upstream', prompt: { prefix: 'p', body: 'b' } })
  })

  it('maps gateway errors to LlmError with retryAfterMs and issues', async () => {
    const transport: LlmTransport = async () => ({ ok: false, code: 'plan-limit', message: 'limit', retryAfterMs: 5000 })
    const llm = createLlmClient({ transport, prompts })
    const err = await llm.call('planner', ctx).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect(err).toMatchObject({ code: 'plan-limit', retryAfterMs: 5000 })
  })

  it('rejects output that fails the role schema with code schema', async () => {
    const transport: LlmTransport = async () => ({ ok: true, data: { nope: 1 }, usage: { input: 1, output: 1, cachedInput: 0 }, model: 'm', effort: 'low', latencyMs: 1 })
    await expect(createLlmClient({ transport, prompts }).call('planner', ctx)).rejects.toMatchObject({ code: 'schema' })
  })

  it('rejects a schema the role cannot return', async () => {
    const llm = createLlmClient({ transport: async () => ({ ok: false, code: 'upstream', message: '' }), prompts })
    // @ts-expect-error GraphIR is not a planner schema
    await expect(llm.call('planner', ctx, { schemaName: 'GraphIR' })).rejects.toMatchObject({ code: 'schema' })
  })

  it('aborts immediately on AbortSignal and logs the abort', async () => {
    const repos = createMemoryRepos()
    let sawSignal: AbortSignal | undefined
    const transport: LlmTransport = (_req, signal) => {
      sawSignal = signal
      return new Promise(() => undefined) // never settles
    }
    const llm = createLlmClient({ transport, prompts, log: repos.llmLog })
    const ac = new AbortController()
    const p = llm.call('planner', ctx, { signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toMatchObject({ code: 'aborted' })
    expect(sawSignal).toBe(ac.signal)
    expect((await repos.llmLog.list())[0]!.outcome).toBe('aborted')
  })
})

describe('record → replay', () => {
  it('records live results (without prompts) and replays them offline', async () => {
    const plan = make.visualPlan()
    const sent: unknown[] = []
    const live: LlmTransport = async (req) => {
      sent.push(req)
      return { ok: true, data: plan, usage: { input: 10, output: 5, cachedInput: 2 }, model: 'gpt-6-sol', effort: 'medium', latencyMs: 9 }
    }
    const store = await memoryFixtures()
    const recorder = createLlmClient({ transport: recordTransport({ live, fixtures: store, models: DEFAULT_MODELS, now: () => 7 }), prompts })
    const recorded = await recorder.call('planner', ctx)
    expect(sent).toHaveLength(1)
    const [f] = store.all()
    // Keyed on the primary model; the fallback that answered is kept inside the fixture.
    expect(f).toMatchObject({ source: 'recorded', model: 'gpt-6.1-sol', usedModel: 'gpt-6-sol', recordedAt: 7 })
    expect(f!.key).toBe(await fixtureKey({ role: 'planner', promptVersion: '1.0.0', model: 'gpt-6.1-sol', ...ctx }))
    expect(JSON.stringify(f)).not.toContain('leader accepts')

    const replayer = createLlmClient({ transport: replayTransport({ fixtures: store, models: DEFAULT_MODELS }), prompts })
    const replayed = await replayer.call('planner', ctx)
    expect(replayed.data).toEqual(recorded.data)
    expect(replayed.model).toBe('gpt-6-sol')
    expect(replayed.usage).toEqual({ input: 10, output: 5, cachedInput: 2 })
  })
})

describe('httpTransport', () => {
  it('posts the request and returns the gateway body; network errors become upstream', async () => {
    const body: LlmResponse = { ok: true, data: make.visualPlan(), usage: { input: 1, output: 1, cachedInput: 0 }, model: 'm', effort: 'low', latencyMs: 1 }
    const seen: RequestInit[] = []
    const t = httpTransport({ fetch: (async (_u: RequestInfo | URL, init?: RequestInit) => (seen.push(init!), Response.json(body))) as typeof fetch })
    const req = { ...make.llmRequest(), requestId: 'r' }
    expect(await t(req)).toEqual(body)
    expect(JSON.parse(String(seen[0]!.body))).toEqual(req)
    const down = httpTransport({ fetch: (async () => { throw new TypeError('fetch failed') }) as typeof fetch })
    expect(await down(req)).toMatchObject({ ok: false, code: 'upstream' })
  })
})
