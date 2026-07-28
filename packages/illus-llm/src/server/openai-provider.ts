// Responses API provider on the official `openai` SDK (§9 step 5). The same code serves both providers:
// only the bearer credential differs (ChatGPT plan access token or API key).
import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError } from 'openai'

import { ProviderError } from '../provider.ts'
import type { LlmProvider, ProviderErrorKind, ProviderId, ProviderRequest } from '../provider.ts'

export const OPENAI_BASE_URL = 'https://api.openai.com/v1'
/** Namespace of the structured-output fallback tool. */
export const TOOL_NAMESPACE = 'illus'

export interface OpenAiProviderOptions {
  id: ProviderId
  baseURL?: string
  /** Per-attempt timeout; deep reasoning can take minutes. */
  timeoutMs?: number
  /** Injected in tests (fake Responses API); defaults to global fetch. */
  fetch?: typeof fetch
}

export function createOpenAiProvider(o: OpenAiProviderOptions): LlmProvider {
  return {
    id: o.id,
    async respond(req) {
      const client = new OpenAI({
        apiKey: req.apiKey,
        baseURL: o.baseURL ?? OPENAI_BASE_URL,
        maxRetries: 0, // the gateway owns retries (§9 step 6)
        timeout: o.timeoutMs ?? 180_000,
        ...(o.fetch && { fetch: o.fetch }),
      })
      try {
        const stream = await client.responses.create(buildRequest(req), { signal: req.signal })
        let final: OpenAI.Responses.Response | undefined
        for await (const event of stream) {
          if (event.type === 'response.completed') final = event.response
          else if (event.type === 'response.failed') {
            const err = event.response.error as { code?: string; message?: string } | null
            throw classify(undefined, err?.code ?? undefined, undefined, err?.message ?? 'response failed')
          } else if (event.type === 'response.incomplete')
            throw new ProviderError('fatal', `response incomplete: ${event.response.incomplete_details?.reason ?? 'unknown reason'}`)
          else if (event.type === 'error') throw classify(undefined, event.code ?? undefined, event.param ?? undefined, event.message)
        }
        if (!final) throw new ProviderError('transient', 'stream ended before response.completed')
        return { text: extractText(final, req), usage: usageOf(final) }
      } catch (e) {
        throw toProviderError(e)
      }
    },
  }
}

/** Plan-route request rules (§9): store false, stream true, instructions not system items, no forbidden fields. */
export function buildRequest(req: ProviderRequest): OpenAI.Responses.ResponseCreateParamsStreaming {
  const content: OpenAI.Responses.ResponseInputContent[] = [{ type: 'input_text', text: req.body }]
  if (req.image) content.push({ type: 'input_image', image_url: `data:${req.image.mediaType};base64,${req.image.base64}`, detail: 'auto' })
  const base = {
    model: req.model,
    instructions: req.instructions,
    input: [{ type: 'message' as const, role: 'user' as const, content }],
    reasoning: { effort: req.effort },
    store: false,
    stream: true as const,
  }
  if (req.structured === 'json_schema')
    return { ...base, text: { format: { type: 'json_schema', name: req.schemaName, schema: req.schema, strict: req.strict } } }
  return {
    ...base,
    tools: [
      {
        type: 'namespace',
        name: TOOL_NAMESPACE,
        description: 'Structured output of the AI Illustrated Reader.',
        tools: [
          {
            type: 'function',
            name: toolName(req.schemaName),
            description: `Return the ${req.schemaName} result. Call exactly once.`,
            parameters: req.schema,
            strict: req.strict,
          },
        ],
      },
    ],
    tool_choice: 'required',
    parallel_tool_calls: false,
  }
}

export const toolName = (schemaName: string) => `emit_${schemaName}`

function extractText(res: OpenAI.Responses.Response, req: ProviderRequest): string {
  if (req.structured === 'tool') {
    const callItem = res.output.find((i) => i.type === 'function_call' && i.name === toolName(req.schemaName))
    if (!callItem || callItem.type !== 'function_call') throw new ProviderError('fatal', 'model did not call the output tool')
    return callItem.arguments
  }
  let text = ''
  for (const item of res.output) {
    if (item.type !== 'message') continue
    for (const part of item.content) {
      if (part.type === 'output_text') text += part.text
      else if (part.type === 'refusal') throw new ProviderError('fatal', `model refused: ${part.refusal}`)
    }
  }
  if (!text) throw new ProviderError('fatal', 'response has no output text')
  return text
}

function usageOf(res: OpenAI.Responses.Response) {
  return {
    input: res.usage?.input_tokens ?? 0,
    output: res.usage?.output_tokens ?? 0,
    cachedInput: res.usage?.input_tokens_details?.cached_tokens ?? 0,
  }
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e
  if (e instanceof APIConnectionTimeoutError) return new ProviderError('timeout', e.message)
  if (e instanceof APIConnectionError) return new ProviderError('transient', e.message)
  if (e instanceof APIError) {
    const body = e.error as { detail?: string; message?: string } | undefined
    const err = classify(e.status, e.code ?? undefined, e.param ?? undefined, body?.message ?? body?.detail ?? e.message)
    const ra = retryAfterMs(e.headers)
    return ra === undefined ? err : new ProviderError(err.kind, err.message, { status: err.status, code: err.code, retryAfterMs: ra })
  }
  if ((e as Error)?.name === 'AbortError') return new ProviderError('fatal', 'aborted')
  return new ProviderError('fatal', (e as Error)?.message ?? String(e))
}

const TRANSIENT_CODES = new Set(['subscription_sharing_usage_unavailable', 'subscription_sharing_user_unavailable', 'server_error'])
const MODEL_CODES = new Set(['model_not_found', 'model_not_available', 'model_not_supported'])

/** Maps an upstream status/code to the gateway's reaction (§9 step 6; OpenAI "Errors and recovery"). */
export function classify(status: number | undefined, code: string | undefined, param: string | undefined, message: string): ProviderError {
  const kind = ((): ProviderErrorKind => {
    if (code === 'subscription_sharing_usage_limit_exceeded') return 'plan-limit'
    if ((code && MODEL_CODES.has(code)) || status === 404) return 'model-unavailable'
    if (code === 'subscription_sharing_unsupported_capability' && param === 'model') return 'model-unavailable'
    if (status === 400 && param && /^text(\.|$)/.test(param)) return 'unsupported-format'
    if (code && TRANSIENT_CODES.has(code)) return 'transient'
    if (status === 429 || code === 'rate_limit_exceeded') return 'rate-limit'
    if (status !== undefined && status >= 500) return 'transient'
    return 'fatal'
  })()
  const detail = [status && `HTTP ${status}`, code, param && `param ${param}`].filter(Boolean).join(', ')
  return new ProviderError(kind, detail ? `${message} (${detail})` : message, {
    ...(status !== undefined && { status }),
    ...(code && { code }),
  })
}

function retryAfterMs(headers: Headers | undefined): number | undefined {
  const ms = Number(headers?.get('retry-after-ms'))
  if (ms > 0) return ms
  const raw = headers?.get('retry-after')
  if (!raw) return undefined
  const s = Number(raw)
  if (Number.isFinite(s)) return Math.max(0, s * 1000)
  const at = Date.parse(raw)
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now())
}
