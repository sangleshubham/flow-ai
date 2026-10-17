// `LlmProvider` (§9 "Provider adapter"): `chatgpt-plan` is the default; `openai-api-key` is an optional
// fallback that is active only when `ILLUS_OPENAI_API_KEY` is set and selected explicitly. The
// implementation (openai SDK, server only) lives in `@illus/llm/server`.
import type {
  LlmImage,
  LlmUsage,
  ReasoningEffort,
  SchemaName,
} from '@illus/core'

import type { JsonSchema } from './json-schema.ts'

export type ProviderId = 'chatgpt-plan' | 'openai-api-key'

/** `json_schema`: `text.format` strict schema. `tool`: one namespaced function tool forced by `tool_choice` (§9 step 5). */
export type StructuredMode = 'json_schema' | 'tool'

export interface ProviderRequest {
  model: string
  /** Always sent as `reasoning.effort`. */
  effort: ReasoningEffort
  /** Role system prompt followed by the stable prefix. */
  instructions: string
  body: string
  image?: LlmImage
  schemaName: SchemaName
  schema: JsonSchema
  strict: boolean
  structured: StructuredMode
  /** Bearer credential: the ChatGPT access token or the API key. */
  apiKey: string
  signal?: AbortSignal
}

export interface ProviderResult {
  /** The JSON text of the structured output (message text or tool arguments). */
  text: string
  usage: LlmUsage
}

/** How the gateway must react to an upstream failure (§9 step 6). */
export type ProviderErrorKind =
  | 'plan-limit' // 429 subscription_sharing_usage_limit_exceeded: never retried
  | 'model-unavailable' // model not found / not entitled: try the next model in the chain
  | 'unsupported-format' // text.format rejected: switch to the tool fallback
  | 'rate-limit' // ordinary 429: honour retry-after
  | 'transient' // 5xx, usage temporarily unavailable, connection reset: back off
  | 'timeout'
  | 'fatal' // anything else: no retry

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  readonly status: number | undefined
  readonly code: string | undefined
  readonly param: string | undefined
  readonly requestId: string | undefined
  readonly retryAfterMs: number | undefined

  constructor(
    kind: ProviderErrorKind,
    message: string,
    extra: {
      status?: number
      code?: string
      param?: string
      requestId?: string
      retryAfterMs?: number
    } = {},
  ) {
    super(message)
    this.name = 'ProviderError'
    this.kind = kind
    this.status = extra.status
    this.code = extra.code
    this.param = extra.param
    this.requestId = extra.requestId
    this.retryAfterMs = extra.retryAfterMs
  }
}

export interface LlmProvider {
  readonly id: ProviderId
  /** Rejects with `ProviderError`. */
  respond(req: ProviderRequest): Promise<ProviderResult>
}
