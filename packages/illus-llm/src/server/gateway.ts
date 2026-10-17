// The `/api/llm` gateway (§9 "Server steps, in order"), framework-free: the Next.js route only adapts
// req/res and supplies the session check. Steps:
// 1 session → 2 tokens (+refresh) → 3 plan-limit pause → 4 route (tier → model, explicit effort, allowlist)
// → 5 Responses API call → 6 retries/fallbacks → 7 Zod parse → 8 per-user usage.
import { LlmRequest, ROLES } from '@illus/core'
import type {
  LlmErrorCode,
  LlmResponse,
  RoleSpec,
  TemplateRegistry,
} from '@illus/core'

import { replayResponse } from '../client.ts'
import { fixtureFromResponse } from '../fixtures.ts'
import type { FixtureStore, LlmMode } from '../fixtures.ts'
import { outputSchema, stripAddedNulls } from '../json-schema.ts'
import { resolveRoute } from '../models.ts'
import type { ModelRun, ModelsConfig, Route } from '../models.ts'
import type { PromptRegistry } from '../prompts.ts'
import { ProviderError } from '../provider.ts'
import type {
  LlmProvider,
  ProviderResult,
  StructuredMode,
} from '../provider.ts'
import { DEFAULT_PLAN_PAUSE_MS } from './usage.ts'
import type { UsageTracker } from './usage.ts'

/** Thrown by a credential source when there are no usable ChatGPT tokens (§9 step 2). */
export class SigninRequiredError extends Error {
  constructor(message = 'sign in with ChatGPT first') {
    super(message)
    this.name = 'SigninRequiredError'
  }
}

export interface GatewayDeps {
  mode: LlmMode
  models: ModelsConfig
  prompts: PromptRegistry
  usage: UsageTracker
  /** Live and record modes. */
  provider?: LlmProvider
  /** Bearer credential for the provider (plan access token, refreshed; or the API key). */
  credential?: (sub: string) => Promise<string>
  /** Replay and record modes. */
  fixtures?: FixtureStore
  /** W5's registry, so `TemplateIR.props` is validated with the template's own schema. */
  templates?: TemplateRegistry
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

export interface GatewayResult {
  status: number
  body: LlmResponse
}

export interface Gateway {
  handle(
    raw: unknown,
    ctx: {
      sub: string | null
      signal?: AbortSignal
      recheckPlanLimit?: boolean
    },
  ): Promise<GatewayResult>
}

const MAX_ATTEMPTS = 3
const STATUS: Record<LlmErrorCode, number> = {
  auth: 401,
  'signin-required': 401,
  'plan-limit': 429,
  schema: 422,
  upstream: 502,
  timeout: 504,
}

export function createGateway(d: GatewayDeps): Gateway {
  const now = d.now ?? Date.now
  const sleep =
    d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const random = d.random ?? Math.random
  // Set once the plan route rejects `text.format`; later calls go straight to the tool fallback.
  let structured: StructuredMode = 'json_schema'
  // Explicit user checks are single-flight and at most once per ten seconds per account.
  // The deployment uses one Node process (ADR 0055); pauses themselves remain durable.
  const rechecks = new Map<string, { until: number; inFlight: boolean }>()

  const fail = (
    code: LlmErrorCode,
    message: string,
    extra: { retryAfterMs?: number; issues?: unknown[]; status?: number } = {},
  ) => {
    const { status, ...rest } = extra
    return {
      status: status ?? STATUS[code],
      body: { ok: false as const, code, message, ...rest },
    }
  }

  async function handle(
    raw: unknown,
    ctx: {
      sub: string | null
      signal?: AbortSignal
      recheckPlanLimit?: boolean
    },
  ): Promise<GatewayResult> {
    // 1. Session.
    if (!ctx.sub) return fail('auth', 'sign in to the reader first')
    const sub = ctx.sub
    const usage = d.usage.forUser(sub)
    const parsedReq = LlmRequest.safeParse(raw)
    if (!parsedReq.success)
      return fail('upstream', 'invalid request', {
        status: 400,
        issues: parsedReq.error.issues,
      })
    const req = parsedReq.data
    // Only image roles (the critic) may send a picture; anything else is a client bug, not a model call.
    if (req.image && !(ROLES[req.role] as RoleSpec).image)
      return fail('upstream', `role ${req.role} does not accept an image`, {
        status: 400,
      })
    const started = now()
    let attempts = 0
    let used: ModelRun | undefined
    let tokens = { input: 0, output: 0, cachedInput: 0 }
    let lastError: ProviderError | undefined

    const finish = async (result: GatewayResult): Promise<GatewayResult> => {
      try {
        await usage.append({
          sub,
          ts: now(),
          requestId: req.requestId,
          role: req.role,
          provider: d.mode === 'replay' ? 'replay' : d.provider?.id ?? '',
          mode: d.mode,
          model: used?.model ?? '',
          effort: used?.effort ?? '',
          inputTokens: tokens.input,
          outputTokens: tokens.output,
          cachedInputTokens: tokens.cachedInput,
          latencyMs: now() - started,
          outcome: result.body.ok ? 'ok' : result.body.code,
          attempts,
          ...(!result.body.ok &&
            lastError && {
              upstreamError: {
                status: lastError.status,
                code: lastError.code,
                param: lastError.param,
                requestId: lastError.requestId,
              },
            }),
        })
      } catch {
        // A full disk must not turn a paid result into an error.
      }
      return result
    }

    // 4 (checks that need no upstream call). Prompt and route.
    if (!d.prompts.has(req.role))
      return finish(
        fail('upstream', `no prompt file docs/prompts/${req.role}.md`, {
          status: 500,
        }),
      )
    const prompt = d.prompts.get(req.role)
    if (prompt.version !== req.promptVersion)
      return finish(
        fail(
          'upstream',
          `prompt version mismatch for ${req.role}: client ${req.promptVersion}, server ${prompt.version}; reload the app`,
          {
            status: 409,
          },
        ),
      )
    let route: Route
    try {
      route = resolveRoute(d.models, req.role, req.escalate)
    } catch (e) {
      return finish(fail('upstream', (e as Error).message, { status: 400 }))
    }
    const schema = outputSchema(req.schemaName, {
      templateId: req.templateId,
      templates: d.templates,
    })
    const parseOutput = (data: unknown) => {
      const parsed = schema.zod.safeParse(
        stripAddedNulls(data, schema.original),
      )
      return parsed.success
        ? { ok: true as const, data: parsed.data }
        : { ok: false as const, issues: parsed.error.issues }
    }

    if (d.mode === 'replay') {
      if (!d.fixtures)
        return finish(
          fail('upstream', 'replay mode has no fixtures configured', {
            status: 500,
          }),
        )
      const res = await replayResponse(req, d.fixtures, route.chain[0]!.model)
      if (!res.ok) return finish({ status: 404, body: res })
      used = { model: res.model, effort: res.effort }
      const out = parseOutput(res.data)
      if (!out.ok)
        return finish(
          fail('schema', `${req.schemaName} fixture failed validation`, {
            issues: out.issues,
          }),
        )
      return finish({ status: 200, body: { ...res, data: out.data } })
    }

    if (!d.provider || !d.credential)
      return finish(
        fail('upstream', `${d.mode} mode has no provider configured`, {
          status: 500,
        }),
      )

    // 2. Credential (loads and refreshes the ChatGPT tokens for the plan provider).
    let apiKey: string
    try {
      apiKey = await d.credential(sub)
    } catch (e) {
      if (e instanceof SigninRequiredError)
        return finish(fail('signin-required', e.message))
      return finish(
        fail('upstream', `could not load credentials: ${(e as Error).message}`),
      )
    }

    // 3. Pause only after OpenAI reports this account’s plan limit.
    const paused = usage.pausedUntil()
    let recheck: { until: number; inFlight: boolean } | undefined
    for (const [account, check] of rechecks)
      if (!check.inFlight && check.until <= now()) rechecks.delete(account)
    const previous = rechecks.get(sub)
    if (paused !== null || previous?.inFlight) {
      if (!ctx.recheckPlanLimit || previous)
        return finish(
          fail(
            'plan-limit',
            previous
              ? 'An access check is in progress or was just made. Wait a few seconds before trying again.'
              : 'Requests are locally paused after an earlier OpenAI usage-limit error. Retry checks your access again.',
            { retryAfterMs: Math.max(0, (paused ?? previous!.until) - now()) },
          ),
        )
      recheck = { until: now() + 10_000, inFlight: true }
      rechecks.set(sub, recheck)
    }

    try {
      // 5–6. Call along the chain; fall back only when a model is unavailable.
      const instructions = `${prompt.systemPrompt}\n\n${req.prefix}`
      let result: ProviderResult | undefined
      chain: for (const run of route.chain) {
        for (let tries = 1; ; tries++) {
          attempts++
          used = run
          try {
            result = await d.provider.respond({
              model: run.model,
              effort: run.effort,
              instructions,
              body: req.body,
              ...(req.image && { image: req.image }),
              schemaName: req.schemaName,
              schema: schema.strict,
              strict: schema.isStrict,
              structured,
              apiKey,
              ...(ctx.signal && { signal: ctx.signal }),
            })
            break chain
          } catch (e) {
            const err =
              e instanceof ProviderError
                ? e
                : new ProviderError('fatal', (e as Error)?.message ?? String(e))
            lastError = err
            switch (err.kind) {
              case 'plan-limit':
                // Never retried; nothing switches to paid billing (§9 step 6, §15).
                usage.pause(now() + (err.retryAfterMs ?? DEFAULT_PLAN_PAUSE_MS))
                return finish(
                  fail(
                    'plan-limit',
                    `OpenAI reported a usage limit for your ChatGPT plan or this app. Review ChatGPT Settings → Usage, or retry after your allowance recovers. ${
                      err.message
                    }${err.requestId ? ` [request ID: ${err.requestId}]` : ''}`,
                    {
                      ...(err.retryAfterMs !== undefined && {
                        retryAfterMs: err.retryAfterMs,
                      }),
                    },
                  ),
                )
              case 'model-unavailable':
                continue chain
              case 'unsupported-format':
                if (structured === 'tool')
                  return finish(fail('upstream', err.message))
                structured = 'tool'
                tries-- // the format switch is not a retry
                continue
              case 'rate-limit':
              case 'transient':
              case 'timeout':
                if (tries >= MAX_ATTEMPTS)
                  return finish(
                    fail(
                      err.kind === 'timeout' ? 'timeout' : 'upstream',
                      err.message,
                    ),
                  )
                await sleep(
                  err.kind === 'rate-limit' && err.retryAfterMs !== undefined
                    ? err.retryAfterMs
                    : backoff(tries, random),
                )
                continue
              default:
                return finish(fail('upstream', err.message))
            }
          }
        }
      }
      if (!result)
        return finish(
          fail(
            'upstream',
            `no model in the ${route.tier} chain is available: ${
              lastError?.message ?? 'unknown error'
            }`,
          ),
        )
      // Clear even a persisted legacy pause once OpenAI completes a request. Schema validation
      // can still fail independently of account access.
      if (paused !== null) usage.resume(paused)
      lastError = undefined
      tokens = result.usage

      // 7. Parse again on the server.
      let json: unknown
      try {
        json = JSON.parse(result.text)
      } catch {
        return finish(
          fail('schema', 'model output is not valid JSON', { issues: [] }),
        )
      }
      const out = parseOutput(json)
      if (!out.ok)
        return finish(
          fail('schema', `${req.schemaName} output failed validation`, {
            issues: out.issues,
          }),
        )
      const body: LlmResponse = {
        ok: true,
        data: out.data,
        usage: result.usage,
        model: used!.model,
        effort: used!.effort,
        latencyMs: now() - started,
      }
      if (d.mode === 'record' && d.fixtures?.put) {
        try {
          await d.fixtures.put(
            await fixtureFromResponse(req, route.chain[0]!.model, body, now()),
          )
        } catch {
          // A failed fixture write must not discard a paid result.
        }
      }
      // 8. Usage line.
      return finish({ status: 200, body })
    } finally {
      if (recheck) recheck.inFlight = false
    }
  }

  return { handle }
}

/** 1 s, 2 s, 4 s with ±20% jitter (§9 step 6). */
export function backoff(
  attempt: number,
  random: () => number = Math.random,
): number {
  return 1000 * 2 ** (attempt - 1) * (0.8 + 0.4 * random())
}
