// Typed client `call(role, ctx, opts)` (§9 "Client"), implementing `LlmCall` from @illus/core.
// Transports decide where a request goes: `/api/llm` over HTTP (browser), fixtures (replay), or live
// plus fixture capture (record). In the app the server applies `ILLUS_LLM_MODE`; the browser always
// uses `httpTransport`.
import {
  LlmError,
  LlmResponse,
  ROLES,
  SCHEMAS,
  roleAllowsSchema,
} from '@illus/core'
import type {
  LlmCall,
  LlmCallOptions,
  LlmLogRepo,
  LlmRequest,
  LlmResult,
  RoleName,
  RoleSchemaName,
  SchemaName,
  SchemaOutput,
} from '@illus/core'

import { fixtureFromResponse, fixtureKey } from './fixtures.ts'
import type { FixtureStore, LlmMode } from './fixtures.ts'
import { resolveRoute } from './models.ts'
import type { ModelsConfig } from './models.ts'
import type { PromptRegistry } from './prompts.ts'

export type LlmTransport = (
  req: LlmRequest,
  signal?: AbortSignal,
) => Promise<LlmResponse>

/** POSTs to `/api/llm` (same origin, session cookie included). Network failures become `upstream`. */
export function httpTransport(
  opts: {
    url?: string
    fetch?: typeof fetch
    recheckPlanLimit?: () => boolean
  } = {},
): LlmTransport {
  const url = opts.url ?? '/api/llm'
  return async (req, signal) => {
    const doFetch = opts.fetch ?? globalThis.fetch
    let res: Response
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(!signal?.aborted &&
            opts.recheckPlanLimit?.() && { 'x-illus-recheck-plan-limit': '1' }),
        },
        body: JSON.stringify(req),
        credentials: 'same-origin',
        signal,
      })
    } catch (e) {
      if (signal?.aborted) throw e
      return {
        ok: false,
        code: 'upstream',
        message: `network error: ${(e as Error).message}`,
      }
    }
    const parsed = LlmResponse.safeParse(
      await res.json().catch(() => undefined),
    )
    if (parsed.success) return parsed.data
    // Next.js answers an oversized body (the /api/llm limit is 4 MB, sized for critic PNGs) with plain text.
    if (res.status === 413)
      return {
        ok: false,
        code: 'upstream',
        message:
          'request too large for /api/llm (4 MB limit; critic image too big?)',
      }
    return {
      ok: false,
      code: 'upstream',
      message: `bad gateway response (HTTP ${res.status})`,
    }
  }
}

/** Looks a request up in the fixtures; no network. Used by the client and by the gateway in replay mode. */
export async function replayResponse(
  req: LlmRequest,
  fixtures: FixtureStore,
  primaryModel: string,
): Promise<LlmResponse> {
  const key = await fixtureKey({
    role: req.role,
    promptVersion: req.promptVersion,
    model: primaryModel,
    prefix: req.prefix,
    body: req.body,
  })
  const f = await fixtures.get(key)
  if (!f)
    return {
      ok: false,
      code: 'upstream',
      message: `replay: no fixture for ${req.role}@${req.promptVersion} (${primaryModel}) key ${key}; record one or add a handwritten fixture`,
    }
  return {
    ok: true,
    data: f.data,
    usage: f.usage ?? { input: 0, output: 0, cachedInput: 0 },
    model: f.usedModel ?? f.model,
    effort: f.effort,
    latencyMs: 0,
  }
}

/** Fixtures only (`ILLUS_LLM_MODE=replay`). */
export function replayTransport(opts: {
  fixtures: FixtureStore
  models: ModelsConfig
}): LlmTransport {
  return (req) =>
    replayResponse(
      req,
      opts.fixtures,
      resolveRoute(opts.models, req.role, req.escalate).chain[0]!.model,
    )
}

/** Live call, then saves the successful result as a fixture (`ILLUS_LLM_MODE=record`). */
export function recordTransport(opts: {
  live: LlmTransport
  fixtures: FixtureStore
  models: ModelsConfig
  now?: () => number
}): LlmTransport {
  if (!opts.fixtures.put)
    throw new Error('record mode needs a writable fixture store')
  return async (req, signal) => {
    const res = await opts.live(req, signal)
    if (!res.ok) return res
    const model = resolveRoute(opts.models, req.role, req.escalate).chain[0]!
      .model
    await opts.fixtures.put!(
      await fixtureFromResponse(req, model, res, (opts.now ?? Date.now)()),
    )
    return res
  }
}

/** Transport for a mode. `live` is required for live and record. */
export function transportFor(
  mode: LlmMode,
  deps: { live?: LlmTransport; fixtures?: FixtureStore; models: ModelsConfig },
): LlmTransport {
  if (mode === 'replay') {
    if (!deps.fixtures) throw new Error('replay mode needs fixtures')
    return replayTransport({ fixtures: deps.fixtures, models: deps.models })
  }
  if (!deps.live) throw new Error(`${mode} mode needs a live transport`)
  if (mode === 'live') return deps.live
  if (!deps.fixtures) throw new Error('record mode needs fixtures')
  return recordTransport({
    live: deps.live,
    fixtures: deps.fixtures,
    models: deps.models,
  })
}

export interface LlmClientOptions {
  transport: LlmTransport
  /** Supplies each role's `promptVersion`. */
  prompts: Pick<PromptRegistry, 'get'>
  /** Receives one `llmLog` row per call (§9). */
  log?: LlmLogRepo
  /** The `debugPrompts` setting: store full prompts in `llmLog` rows. */
  debugPrompts?: () => boolean
  now?: () => number
  newRequestId?: () => string
}

export function createLlmClient(o: LlmClientOptions): LlmCall {
  const now = o.now ?? Date.now
  const newId = o.newRequestId ?? (() => globalThis.crypto.randomUUID())

  async function call<
    R extends RoleName,
    S extends RoleSchemaName<R> = RoleSchemaName<R>,
  >(
    role: R,
    ctx: { prefix: string; body: string },
    opts: LlmCallOptions<S> = {},
  ): Promise<LlmResult<SchemaOutput<S>>> {
    const schemaName = (opts.schemaName ?? ROLES[role].schemas[0]) as SchemaName
    if (!roleAllowsSchema(role, schemaName))
      throw new LlmError('schema', `role ${role} cannot return ${schemaName}`)
    const promptVersion = o.prompts.get(role).version
    const requestId = opts.requestId ?? newId()
    const req: LlmRequest = {
      role,
      promptVersion,
      prefix: ctx.prefix,
      body: ctx.body,
      schemaName,
      requestId,
      ...(opts.templateId && { templateId: opts.templateId }),
      ...(opts.image && { image: opts.image }),
      ...(opts.escalate && { escalate: true }),
    }
    const started = now()
    const log = async (
      outcome: LlmError['code'] | 'ok',
      res?: Extract<LlmResponse, { ok: true }>,
    ) => {
      if (!o.log) return
      try {
        await o.log.add({
          requestId,
          role,
          promptVersion,
          model: res?.model ?? '',
          effort: res?.effort ?? ROLES[role].effort,
          inputTokens: res?.usage.input ?? 0,
          outputTokens: res?.usage.output ?? 0,
          cachedInputTokens: res?.usage.cachedInput ?? 0,
          latencyMs: res?.latencyMs ?? now() - started,
          outcome,
          ...(opts.bookId && { bookId: opts.bookId }),
          ...(opts.sectionId && { sectionId: opts.sectionId }),
          ...(o.debugPrompts?.() && {
            prompt: { prefix: ctx.prefix, body: ctx.body },
          }),
          createdAt: now(),
        })
      } catch {
        // Logging never fails a call.
      }
    }

    const res = await withAbort(
      o.transport(req, opts.signal),
      opts.signal,
    ).catch(async (e: unknown) => {
      if (opts.signal?.aborted) {
        await log('aborted')
        throw new LlmError('aborted', 'request aborted by the caller')
      }
      await log('upstream')
      throw new LlmError('upstream', (e as Error)?.message ?? String(e))
    })
    if (!res.ok) {
      await log(res.code)
      throw new LlmError(res.code, res.message, {
        ...(res.retryAfterMs !== undefined && {
          retryAfterMs: res.retryAfterMs,
        }),
        ...(res.issues && { issues: res.issues }),
      })
    }
    const parsed = SCHEMAS[schemaName].safeParse(res.data)
    if (!parsed.success) {
      await log('schema')
      throw new LlmError('schema', `${schemaName} output failed validation`, {
        issues: parsed.error.issues,
      })
    }
    await log('ok', res)
    return {
      data: parsed.data as SchemaOutput<S>,
      model: res.model,
      effort: res.effort,
      promptVersion,
      usage: res.usage,
      latencyMs: res.latencyMs,
      requestId,
    }
  }
  return { call }
}

/** Rejects as soon as `signal` aborts, even if the transport ignores it. */
function withAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() =>
      signal.removeEventListener('abort', onAbort),
    )
  })
}
