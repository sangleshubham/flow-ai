import { describe, expect, it } from 'vitest'

import { make } from '@illus/core/testing'

import { DEFAULT_MODELS, outputSchema } from '../src/index.ts'
import type { ProviderRequest } from '../src/index.ts'
import {
  createGateway,
  createOpenAiProvider,
  createUsageTracker,
  openReaderDb,
} from '../src/server/index.ts'
import {
  allPrompts,
  completedResponse,
  errorResponse,
  fakeFetch,
  sse,
  textStream,
  toolStream,
} from './helpers.ts'

const schema = outputSchema('VisualPlan')
const base: ProviderRequest = {
  model: 'gpt-6.1-sol',
  effort: 'medium',
  instructions: 'SYSTEM\n\nPREFIX',
  body: 'BODY',
  schemaName: 'VisualPlan',
  schema: schema.strict,
  strict: true,
  structured: 'json_schema',
  apiKey: 'access-token',
}
const FORBIDDEN = [
  'temperature',
  'max_output_tokens',
  'metadata',
  'prompt_cache_retention',
  'previous_response_id',
  'top_p',
  'user',
  'truncation',
  'background',
]

describe('openai provider (fake Responses API, no network)', () => {
  it.each([false, true])(
    'preserves the upstream request ID and parameter (stream=%s)',
    async (streaming) => {
      const response = streaming
        ? sse([
            {
              type: 'error',
              code: 'subscription_sharing_usage_limit_exceeded',
              param: 'model',
              message: 'Original limit message',
            },
          ])
        : errorResponse(
            429,
            {
              code: 'subscription_sharing_usage_limit_exceeded',
              param: 'model',
              message: 'Original limit message',
            },
            { 'retry-after': '120' },
          )
      response.headers.set('x-request-id', 'req_diagnostic')
      const f = fakeFetch(() => response)
      await expect(
        createOpenAiProvider({ id: 'chatgpt-plan', fetch: f.fetch }).respond(
          base,
        ),
      ).rejects.toMatchObject({
        kind: 'plan-limit',
        code: 'subscription_sharing_usage_limit_exceeded',
        param: 'model',
        requestId: 'req_diagnostic',
        status: streaming ? 200 : 429,
        message: expect.stringContaining('Original limit message'),
      })
    },
  )
  it('sends the plan-route request shape and accumulates the stream', async () => {
    const plan = make.visualPlan()
    const f = fakeFetch(() => textStream(plan))
    const p = createOpenAiProvider({ id: 'chatgpt-plan', fetch: f.fetch })
    const res = await p.respond(base)
    expect(JSON.parse(res.text)).toEqual(plan)
    expect(res.usage).toEqual({ input: 120, output: 40, cachedInput: 100 })
    const { url, body, headers } = f.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(headers.get('authorization')).toBe('Bearer access-token')
    expect(body).toMatchObject({
      model: 'gpt-6.1-sol',
      instructions: 'SYSTEM\n\nPREFIX',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'BODY' }],
        },
      ],
      reasoning: { effort: 'medium' },
      store: false,
      stream: true,
      text: {
        format: {
          type: 'json_schema',
          name: 'VisualPlan',
          strict: true,
          schema: schema.strict,
        },
      },
    })
    for (const k of FORBIDDEN) expect(body).not.toHaveProperty(k)
    expect(JSON.stringify(body)).not.toContain('"role":"system"')
  })

  it('falls back to output_item.done items when response.completed has an empty output', async () => {
    const plan = make.visualPlan()
    const text = JSON.stringify(plan)
    const item = {
      type: 'message',
      id: 'm1',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    }
    const f = fakeFetch(() =>
      sse([
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: completedResponse([]) },
      ]),
    )
    const res = await createOpenAiProvider({
      id: 'chatgpt-plan',
      fetch: f.fetch,
    }).respond(base)
    expect(JSON.parse(res.text)).toEqual(plan)
  })

  it('adds the critic image as an input_image part', async () => {
    const f = fakeFetch(() => textStream(make.criticReport()))
    await createOpenAiProvider({ id: 'chatgpt-plan', fetch: f.fetch }).respond({
      ...base,
      schemaName: 'CriticReport',
      image: { mediaType: 'image/png', base64: 'iVBORw0K' },
    })
    expect(
      (f.calls[0]!.body.input as { content: unknown[] }[])[0]!.content[1],
    ).toEqual({
      type: 'input_image',
      image_url: 'data:image/png;base64,iVBORw0K',
      detail: 'auto',
    })
  })

  it('tool fallback: one namespaced function tool forced by tool_choice', async () => {
    const plan = make.visualPlan()
    const f = fakeFetch(() => toolStream('VisualPlan', plan))
    const res = await createOpenAiProvider({
      id: 'chatgpt-plan',
      fetch: f.fetch,
    }).respond({ ...base, structured: 'tool' })
    expect(JSON.parse(res.text)).toEqual(plan)
    const body = f.calls[0]!.body
    expect(body).not.toHaveProperty('text')
    expect(body).toMatchObject({
      tool_choice: 'required',
      tools: [
        {
          type: 'namespace',
          name: 'illus',
          tools: [
            {
              type: 'function',
              name: 'emit_VisualPlan',
              parameters: schema.strict,
              strict: true,
            },
          ],
        },
      ],
      reasoning: { effort: 'medium' },
    })
  })

  it.each([
    [
      'HTTP 429 subscription_sharing_usage_limit_exceeded',
      () =>
        errorResponse(
          429,
          { code: 'subscription_sharing_usage_limit_exceeded' },
          { 'retry-after': '120' },
        ),
      'plan-limit',
      120_000,
    ],
    [
      'plan limit as response.failed mid-stream',
      () =>
        sse([
          {
            type: 'response.failed',
            response: {
              id: 'r',
              status: 'failed',
              output: [],
              error: {
                code: 'subscription_sharing_usage_limit_exceeded',
                message: 'limit',
              },
            },
          },
        ]),
      'plan-limit',
      undefined,
    ],
    [
      'ordinary 429',
      () =>
        errorResponse(
          429,
          { code: 'rate_limit_exceeded' },
          { 'retry-after-ms': '1500' },
        ),
      'rate-limit',
      1500,
    ],
    [
      '404 model',
      () => errorResponse(404, { code: 'model_not_found' }),
      'model-unavailable',
      undefined,
    ],
    [
      'unsupported model capability',
      () =>
        errorResponse(400, {
          code: 'subscription_sharing_unsupported_capability',
          param: 'model',
        }),
      'model-unavailable',
      undefined,
    ],
    [
      'text.format rejected',
      () =>
        errorResponse(400, {
          code: 'subscription_sharing_unsupported_capability',
          param: 'text.format',
        }),
      'unsupported-format',
      undefined,
    ],
    [
      '503 usage unavailable',
      () =>
        errorResponse(503, { code: 'subscription_sharing_usage_unavailable' }),
      'transient',
      undefined,
    ],
    [
      '500',
      () => errorResponse(500, { code: 'server_error' }),
      'transient',
      undefined,
    ],
    [
      '403 not eligible',
      () =>
        errorResponse(403, { code: 'subscription_sharing_user_not_eligible' }),
      'fatal',
      undefined,
    ],
    [
      'stream ends early',
      () =>
        sse([
          {
            type: 'response.output_text.delta',
            delta: '{',
            item_id: 'm',
            output_index: 0,
            content_index: 0,
          },
        ]),
      'transient',
      undefined,
    ],
  ])('classifies %s', async (_name, response, kind, retryAfterMs) => {
    const f = fakeFetch(response)
    const err = await createOpenAiProvider({
      id: 'chatgpt-plan',
      fetch: f.fetch,
    })
      .respond(base)
      .catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'ProviderError', kind, retryAfterMs })
    expect(f.calls).toHaveLength(1) // the SDK never retries on its own
  })
})

describe('gateway + openai provider end to end (fake stream)', () => {
  async function gatewayWith(fetchFn: typeof fetch) {
    return createGateway({
      mode: 'live',
      models: DEFAULT_MODELS,
      prompts: allPrompts(),
      usage: createUsageTracker({ db: openReaderDb({ memory: true }) }),
      provider: createOpenAiProvider({ id: 'chatgpt-plan', fetch: fetchFn }),
      credential: async () => 'tok',
      sleep: async () => undefined,
    })
  }
  const request = { ...make.llmRequest(), requestId: 'e2e' }

  it('structured-output fallback path: text.format rejected → tool call → parsed data', async () => {
    const plan = make.visualPlan()
    const f = fakeFetch(
      () =>
        errorResponse(400, {
          code: 'subscription_sharing_unsupported_capability',
          param: 'text.format',
          message: 'text.format is not supported',
        }),
      () => toolStream('VisualPlan', plan),
    )
    const res = await (
      await gatewayWith(f.fetch)
    ).handle(request, { sub: 'test' })
    expect(res.body).toMatchObject({ ok: true, data: plan, effort: 'medium' })
    expect(f.calls[0]!.body).toHaveProperty('text')
    expect(f.calls[1]!.body).toHaveProperty('tools')
    for (const c of f.calls)
      expect(c.body.reasoning).toEqual({ effort: 'medium' })
  })

  it('critic: the PNG reaches the Responses API as an input_image after the body text', async () => {
    const png = Buffer.from('\x89PNG\r\n\x1a\n fake critic render').toString(
      'base64',
    )
    const f = fakeFetch(() => textStream(make.criticReport()))
    const res = await (
      await gatewayWith(f.fetch)
    ).handle(
      {
        ...request,
        role: 'critic',
        schemaName: 'CriticReport',
        body: 'INTENT + IR SUMMARY',
        image: { mediaType: 'image/png', base64: png },
      },
      { sub: 'test' },
    )
    expect(res.body).toMatchObject({ ok: true, data: make.criticReport() })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]!.body.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'INTENT + IR SUMMARY' },
          {
            type: 'input_image',
            image_url: `data:image/png;base64,${png}`,
            detail: 'auto',
          },
        ],
      },
    ])
  })

  it('an image on a non-image role is rejected before any upstream call', async () => {
    const f = fakeFetch(() => textStream(make.visualPlan()))
    const res = await (
      await gatewayWith(f.fetch)
    ).handle(
      { ...request, image: { mediaType: 'image/png', base64: 'iVBORw0K' } },
      { sub: 'test' },
    )
    expect(res).toMatchObject({ status: 400, body: { ok: false } })
    expect(f.calls).toHaveLength(0)
  })

  it('plan-limit 429 → one upstream request, code plan-limit, no paid fallback', async () => {
    const f = fakeFetch(() =>
      errorResponse(429, { code: 'subscription_sharing_usage_limit_exceeded' }),
    )
    const res = await (
      await gatewayWith(f.fetch)
    ).handle(request, { sub: 'test' })
    expect(res).toMatchObject({ status: 429, body: { code: 'plan-limit' } })
    expect(f.calls).toHaveLength(1)
  })
})

describe('stream idle timeout', () => {
  const stalled = () =>
    (async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                'event: response.created\ndata: {"type":"response.created","sequence_number":0}\n\n',
              ),
            )
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )) as unknown as typeof fetch

  it('rejects with a timeout ProviderError when the stream goes silent', async () => {
    const p = createOpenAiProvider({
      id: 'chatgpt-plan',
      fetch: stalled(),
      idleTimeoutMs: 50,
    })
    await expect(p.respond(base)).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'timeout',
    })
  })

  it('still aborts on caller abort', async () => {
    const ac = new AbortController()
    const p = createOpenAiProvider({
      id: 'chatgpt-plan',
      fetch: stalled(),
      idleTimeoutMs: 5000,
    })
    const r = p.respond({ ...base, signal: ac.signal })
    setTimeout(() => ac.abort(), 20)
    await expect(r).rejects.not.toMatchObject({ kind: 'timeout' })
  })
})
