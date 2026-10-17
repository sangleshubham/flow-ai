// M0 check (spec §9 "Rules for W2"): which allowlisted models work on the ChatGPT plan route with an
// explicit effort and structured output, and whether the critic's model accepts image input.
// LIVE CALLS on Shubham's plan (about 2 per model). Run by Shubham only, never by an agent or CI:
//   node --env-file=apps/reader/.env.local packages/illus-llm/scripts/verify-models.ts
import {
  createPromptRegistry,
  loadModelsConfig,
  outputSchema,
  resolveRoute,
} from '../src/index.ts'
import type { StructuredMode } from '../src/index.ts'
import { createIllusServer, createOpenAiProvider } from '../src/server/index.ts'

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const server = await createIllusServer(
  { ...process.env, ILLUS_LLM_MODE: 'live' },
  { prompts: createPromptRegistry({}) },
)
if (!server.auth)
  throw new Error(
    'Set ILLUS_TOKEN_ENC_KEY and ILLUS_PUBLIC_URL, then sign in first',
  )
const sub = process.env.ILLUS_EVAL_SUB?.trim() || (await server.ownerSub())
if (!sub)
  throw new Error('Set ILLUS_EVAL_SUB to the signed-in account to probe')
const token = await server.auth.getPlanToken(sub)
const models = loadModelsConfig(process.env.ILLUS_MODELS_JSON)

const listed = await fetch('https://api.openai.com/v1/models', {
  headers: { authorization: `Bearer ${token}` },
})
const catalog = (await listed.json()) as {
  models?: { slug: string; visibility?: string }[]
  data?: { id: string }[]
}
const slugs = new Set([
  ...(catalog.models ?? []).map((m) => m.slug),
  ...(catalog.data ?? []).map((m) => m.id),
])
console.log(`GET /v1/models → HTTP ${listed.status}, ${slugs.size} models`)

const provider = createOpenAiProvider({ id: 'chatgpt-plan' })
const schema = outputSchema('BookSummary')
async function probe(model: string, structured: StructuredMode, image = false) {
  try {
    const res = await provider.respond({
      model,
      effort: 'low',
      instructions:
        'Return a one-sentence summary and an empty conventions list.',
      body: image
        ? 'Describe the attached image in one sentence.'
        : 'The book is about replicated logs.',
      ...(image && {
        image: { mediaType: 'image/png' as const, base64: PNG_1X1 },
      }),
      schemaName: 'BookSummary',
      schema: schema.strict,
      strict: true,
      structured,
      apiKey: token,
    })
    JSON.parse(res.text)
    return 'ok'
  } catch (e) {
    return `${(e as { kind?: string }).kind ?? 'error'}: ${
      (e as Error).message
    }`
  }
}

for (const model of models.allowlist) {
  const listedNote = slugs.has(model) ? 'listed' : 'NOT listed'
  const viaFormat = await probe(model, 'json_schema')
  const viaTool = viaFormat === 'ok' ? 'skipped' : await probe(model, 'tool')
  console.log(
    `${model.padEnd(16)} ${listedNote.padEnd(
      11,
    )} text.format: ${viaFormat} | tool fallback: ${viaTool}`,
  )
}

const critic = resolveRoute(models, 'critic').chain[0]!
console.log(
  `critic model ${critic.model} with image input: ${await probe(
    critic.model,
    'json_schema',
    true,
  )}`,
)
console.log(
  'If the critic model rejects images, set ILLUS_MODELS_JSON roleOverrides.critic to gpt-6-astra at low (spec §9).',
)
