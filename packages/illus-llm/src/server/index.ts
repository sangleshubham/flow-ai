// `@illus/llm/server`: the Node-only half of @illus/llm (ADR 0006): gateway, providers, Sign in with
// ChatGPT, token store, session cookie, per-user usage. Imported by `apps/reader/src/server/*` only.
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { TemplateRegistry } from '@illus/core'

import { llmModeFrom } from '../fixtures.ts'
import type { FixtureStore, LlmMode } from '../fixtures.ts'
import { loadModelsConfig } from '../models.ts'
import type { ModelsConfig } from '../models.ts'
import type { PromptRegistry } from '../prompts.ts'
import type { ProviderId } from '../provider.ts'
import { PASTE_REDIRECT_URI, createChatGptAuth } from './chatgpt-auth.ts'
import type { ChatGptAuth } from './chatgpt-auth.ts'
import { migrateLegacyFiles, openReaderDb } from './db.ts'
import { fileFixtures } from './fixtures-fs.ts'
import { createGateway } from './gateway.ts'
import type { Gateway } from './gateway.ts'
import { createOpenAiProvider } from './openai-provider.ts'
import { createSessions } from './session.ts'
import type { Sessions } from './session.ts'
import { createTokenStore, parseEncKey } from './token-store.ts'
import { createUsageTracker } from './usage.ts'
import type { UsageTracker } from './usage.ts'

export * from './chatgpt-auth.ts'
export * from './db.ts'
export * from './fixtures-fs.ts'
export * from './gateway.ts'
export * from './openai-provider.ts'
export * from './session.ts'
export * from './token-store.ts'
export * from './usage.ts'

export interface IllusServer {
  mode: LlmMode
  provider: ProviderId
  models: ModelsConfig
  gateway: Gateway
  sessions: Sessions
  usage: UsageTracker
  /** Present when `ILLUS_TOKEN_ENC_KEY` is set (required for the plan provider). */
  auth: ChatGptAuth | undefined
  /**
   * The reader is not on `http://127.0.0.1`, so OpenAI cannot redirect back to it: sign-in ends with the user
   * pasting the loopback address their browser landed on (ADR 0047).
   */
  pasteSignin: boolean
  access: 'open' | 'owner'
  ownerSub(): Promise<string | undefined>
}

export interface IllusServerOptions {
  prompts: PromptRegistry
  templates?: TemplateRegistry
  /** Defaults to `ILLUS_FIXTURES_DIR`, else `<cwd>/fixtures/llm`. */
  fixtures?: FixtureStore
  /** Test seam for the fake OIDC server and Responses API; never set in production. */
  fetch?: typeof fetch
  now?: () => number
}

/**
 * Builds the server side from the §9 environment variables. Throws with a clear message on invalid
 * configuration (bad `ILLUS_MODELS_JSON`, missing key for the selected provider, …).
 */
export async function createIllusServer(
  env: Record<string, string | undefined>,
  o: IllusServerOptions,
): Promise<IllusServer> {
  const access = env.ILLUS_ACCESS ?? 'open'
  if (access !== 'open' && access !== 'owner')
    throw new Error('ILLUS_ACCESS must be open or owner')
  const allowedEmails = env.ILLUS_ALLOWED_EMAILS?.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const mode = llmModeFrom(env.ILLUS_LLM_MODE)
  const models = loadModelsConfig(env.ILLUS_MODELS_JSON)
  const provider = (env.ILLUS_LLM_PROVIDER?.trim() ||
    'chatgpt-plan') as ProviderId
  if (provider !== 'chatgpt-plan' && provider !== 'openai-api-key')
    throw new Error(
      `ILLUS_LLM_PROVIDER must be chatgpt-plan or openai-api-key, not ${provider}`,
    )
  if (provider === 'openai-api-key' && !env.ILLUS_OPENAI_API_KEY)
    throw new Error(
      'ILLUS_LLM_PROVIDER=openai-api-key needs ILLUS_OPENAI_API_KEY',
    )
  const live = mode !== 'replay'
  if (live && !env.ILLUS_DATA_DIR)
    throw new Error('ILLUS_DATA_DIR is required outside replay mode')
  const dataDir = env.ILLUS_DATA_DIR ?? join(tmpdir(), 'illus-replay')
  const publicUrl = env.ILLUS_PUBLIC_URL ?? 'http://127.0.0.1:3000'

  const allowed = env.ILLUS_ALLOWED_ACCOUNT_ID?.trim() || undefined
  const ownerSub = async () => {
    if (allowed) return allowed
    try {
      const registration = JSON.parse(
        await readFile(join(dataDir, 'chatgpt-registration.json'), 'utf8'),
      ) as { ownerSub?: string }
      return registration.ownerSub
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw e
    }
  }
  // Validate secrets before creating storage, so a bad configuration leaves no open database.
  if (!env.ILLUS_SESSION_SECRET || env.ILLUS_SESSION_SECRET.length < 32)
    throw new Error('ILLUS_SESSION_SECRET must be at least 32 characters')
  if (live && provider === 'chatgpt-plan' && !env.ILLUS_TOKEN_ENC_KEY)
    throw new Error(
      'ILLUS_TOKEN_ENC_KEY is required for the chatgpt-plan provider',
    )
  const key = env.ILLUS_TOKEN_ENC_KEY
    ? parseEncKey(env.ILLUS_TOKEN_ENC_KEY)
    : undefined
  const db = openReaderDb({ dir: dataDir })
  try {
    if (key)
      migrateLegacyFiles(db, {
        dir: dataDir,
        key,
        ownerSub: await ownerSub(),
        now: o.now ?? Date.now,
      })
  } catch (e) {
    db.close()
    throw e
  }
  if (
    env.ILLUS_MAX_REQUESTS_5H !== undefined ||
    env.ILLUS_MAX_REQUESTS_DAY !== undefined
  )
    console.warn(
      'ILLUS_MAX_REQUESTS_5H and ILLUS_MAX_REQUESTS_DAY are ignored; usage continues until the account’s ChatGPT plan limit.',
    )
  const usage = createUsageTracker({ db, ...(o.now && { now: o.now }) })
  const sessions = createSessions({
    db,
    secret: env.ILLUS_SESSION_SECRET,
    secure: publicUrl.startsWith('https:'),
    ...(access === 'owner' && { allowedSub: await ownerSub() }),
    ...(o.now && { now: o.now }),
  })

  let auth: ChatGptAuth | undefined
  const pasteSignin = !isLoopbackUrl(publicUrl)
  if (key) {
    auth = createChatGptAuth({
      store: createTokenStore({ db, dir: dataDir, key }),
      key,
      publicUrl,
      ...(pasteSignin && { redirectUri: PASTE_REDIRECT_URI }),
      access:
        access === 'open'
          ? { mode: 'open', ...(allowedEmails?.length && { allowedEmails }) }
          : {
              mode: 'owner',
              ...(allowed
                ? { allowedAccountId: allowed }
                : { claimOwner: true }),
            },
      ...(env.ILLUS_CHATGPT_CLIENT_ID && {
        clientId: env.ILLUS_CHATGPT_CLIENT_ID.trim(),
      }),
      ...(env.ILLUS_CHATGPT_ISSUER && { issuer: env.ILLUS_CHATGPT_ISSUER }),
      ...(o.fetch && { fetch: o.fetch }),
      ...(o.now && { now: o.now }),
    })
  } else if (live && provider === 'chatgpt-plan')
    throw new Error(
      'ILLUS_TOKEN_ENC_KEY is required for the chatgpt-plan provider',
    )

  const fixtures =
    mode === 'live'
      ? undefined
      : o.fixtures ??
        (await fileFixtures(
          env.ILLUS_FIXTURES_DIR ?? join(process.cwd(), 'fixtures', 'llm'),
        ))
  const apiKey = env.ILLUS_OPENAI_API_KEY
  const gateway = createGateway({
    mode,
    models,
    prompts: o.prompts,
    usage,
    ...(fixtures && { fixtures }),
    ...(o.templates && { templates: o.templates }),
    ...(o.now && { now: o.now }),
    ...(live && {
      provider: createOpenAiProvider({
        id: provider,
        ...(o.fetch && { fetch: o.fetch }),
      }),
      credential:
        provider === 'openai-api-key'
          ? async () => apiKey!
          : (sub) => auth!.getPlanToken(sub),
    }),
  })
  return {
    mode,
    provider,
    models,
    gateway,
    sessions,
    usage,
    auth,
    pasteSignin,
    access,
    ownerSub,
  }
}

/** OpenAI redirects only to `http://127.0.0.1:<port>` (ADR 0007). */
export function isLoopbackUrl(url: string): boolean {
  return /^http:\/\/127\.0\.0\.1(?::\d+)?\/?$/.test(url)
}
