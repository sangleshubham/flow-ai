// LLM fixtures for `ILLUS_LLM_MODE=replay|record` (§9 client, §18). Key = SHA-256 of
// `{role, promptVersion, model, prefix, body}` where `model` is the route's primary model (ADR 0007):
// replay cannot know which fallback a recording used, so the model actually used is stored inside.
import { z } from 'zod'

import { LlmUsage, ReasoningEffort, RoleName, SchemaName, TemplateId, sha256Hex } from '@illus/core'
import type { LlmRequest, LlmResponse } from '@illus/core'

export const LlmMode = z.enum(['live', 'record', 'replay'])
export type LlmMode = z.infer<typeof LlmMode>

/** `ILLUS_LLM_MODE`; anything unset or unknown means `replay` (CLAUDE.md rule 6). */
export function llmModeFrom(value: string | undefined): LlmMode {
  const parsed = LlmMode.safeParse(value?.trim())
  return parsed.success ? parsed.data : 'replay'
}

export interface FixtureKeyInput {
  role: RoleName
  promptVersion: string
  /** Primary model of the role's route (not a fallback). */
  model: string
  prefix: string
  body: string
}

export function fixtureKey(i: FixtureKeyInput): Promise<string> {
  return sha256Hex(JSON.stringify({ role: i.role, promptVersion: i.promptVersion, model: i.model, prefix: i.prefix, body: i.body }))
}

/**
 * One file in `fixtures/llm/<role>/<key>.json`. Hand-written fixtures carry `"source": "handwritten"`
 * and may omit `key` when they include `prefix` and `body` (the key is computed on load).
 */
export const Fixture = z.object({
  key: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  source: z.enum(['recorded', 'handwritten']),
  role: RoleName,
  promptVersion: z.string().min(1),
  /** Primary model used in the key. */
  model: z.string().min(1),
  /** Model and effort that actually answered (equal to `model` unless a fallback ran). */
  usedModel: z.string().min(1).optional(),
  effort: ReasoningEffort,
  schemaName: SchemaName,
  templateId: TemplateId.optional(),
  prefix: z.string().optional(),
  body: z.string().optional(),
  data: z.unknown(),
  usage: LlmUsage.optional(),
  recordedAt: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
})
export type Fixture = z.infer<typeof Fixture>

export interface FixtureStore {
  get(key: string): Promise<Fixture | undefined>
  /** Record mode only. */
  put?(fixture: Fixture & { key: string }): Promise<void>
}

/** Resolves a fixture's key (given, or computed from its prefix and body). */
export async function keyOfFixture(f: Fixture): Promise<string> {
  if (f.key) return f.key
  if (f.prefix === undefined || f.body === undefined) throw new Error(`fixture for ${f.role} needs either key or prefix and body`)
  return fixtureKey({ role: f.role, promptVersion: f.promptVersion, model: f.model, prefix: f.prefix, body: f.body })
}

/**
 * The fixture recorded for a successful live response. Prompts are not stored: recorded fixtures must
 * never carry book text (CLAUDE.md rule 7).
 */
export async function fixtureFromResponse(
  req: LlmRequest,
  primaryModel: string,
  res: Extract<LlmResponse, { ok: true }>,
  recordedAt: number,
): Promise<Fixture & { key: string }> {
  return {
    key: await fixtureKey({ role: req.role, promptVersion: req.promptVersion, model: primaryModel, prefix: req.prefix, body: req.body }),
    source: 'recorded',
    role: req.role,
    promptVersion: req.promptVersion,
    model: primaryModel,
    usedModel: res.model,
    effort: res.effort,
    schemaName: req.schemaName,
    ...(req.templateId && { templateId: req.templateId }),
    data: res.data,
    usage: res.usage,
    recordedAt,
  }
}

/** In-memory fixture store, e.g. for tests or fixtures bundled with a test suite. */
export async function memoryFixtures(fixtures: readonly unknown[] = []): Promise<FixtureStore & { all(): Fixture[] }> {
  const map = new Map<string, Fixture>()
  for (const raw of fixtures) {
    const f = Fixture.parse(raw)
    map.set(await keyOfFixture(f), f)
  }
  return {
    get: async (key) => map.get(key),
    put: async (f) => void map.set(f.key, Fixture.parse(f)),
    all: () => [...map.values()],
  }
}
