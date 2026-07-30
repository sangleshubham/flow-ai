// Model configuration (`ILLUS_MODELS_JSON`, spec §9 "Model mapping"): tier → model chain, per-role
// efforts, escalation effort, allowlist. Shared by the gateway (which model to call) and the client
// (fixture keys in replay mode).
import { z } from 'zod'

import { ROLES, RoleName, Tier } from '@illus/core'
import type { ReasoningEffort } from '@illus/core'

/** v1 allows only these efforts (§9). `none`, `xhigh`, `max`, `ultra` are rejected with a clear message. */
const Effort = z.enum(['low', 'medium', 'high'], {
  error: (iss) => `effort ${JSON.stringify(iss.input)} is not allowed in v1 (only low, medium, high)`,
})

const ModelEntry = z.strictObject({ model: z.string().min(1), effort: Effort.optional() })
export type ModelEntry = z.infer<typeof ModelEntry>

const RoleOverride = z.strictObject({
  /** Run the role on another tier. */
  tier: Tier.optional(),
  escalationTier: Tier.optional(),
  /** Replace the tier's chain for this role, e.g. `[{ "model": "gpt-6-astra", "effort": "low" }]` for the critic. */
  models: z.array(ModelEntry).min(1).optional(),
  effort: Effort.optional(),
})

export const ModelsConfig = z
  .strictObject({
    tiers: z.strictObject({
      fast: z.array(ModelEntry).min(1),
      standard: z.array(ModelEntry).min(1),
      deep: z.array(ModelEntry).min(1),
    }),
    efforts: z.partialRecord(RoleName, Effort),
    escalationEffort: z.partialRecord(z.union([z.literal('default'), RoleName]), Effort),
    allowedEfforts: z.array(Effort).min(1),
    allowlist: z.array(z.string().min(1)).min(1),
    roleOverrides: z.partialRecord(RoleName, RoleOverride),
  })
  .superRefine((c, ctx) => {
    const allowed = new Set<string>(c.allowedEfforts)
    const models = new Set(c.allowlist)
    const check = (path: (string | number)[], entry: ModelEntry) => {
      if (!models.has(entry.model)) ctx.addIssue({ code: 'custom', path, message: `model ${entry.model} is not on the allowlist` })
      if (entry.effort && !allowed.has(entry.effort))
        ctx.addIssue({ code: 'custom', path, message: `effort ${entry.effort} is not in allowedEfforts` })
    }
    for (const tier of Tier.options) c.tiers[tier].forEach((e, i) => check(['tiers', tier, i], e))
    for (const [role, o] of Object.entries(c.roleOverrides)) {
      o?.models?.forEach((e, i) => check(['roleOverrides', role, 'models', i], e))
      if (o?.effort && !allowed.has(o.effort))
        ctx.addIssue({ code: 'custom', path: ['roleOverrides', role, 'effort'], message: `effort ${o.effort} is not in allowedEfforts` })
    }
    for (const [key, e] of [...Object.entries(c.efforts), ...Object.entries(c.escalationEffort)])
      if (e && !allowed.has(e)) ctx.addIssue({ code: 'custom', path: [key], message: `effort ${e} is not in allowedEfforts` })
    if (!c.escalationEffort.default) ctx.addIssue({ code: 'custom', path: ['escalationEffort'], message: 'escalationEffort.default is required' })
  })
export type ModelsConfig = z.infer<typeof ModelsConfig>

/** The default `ILLUS_MODELS_JSON` from spec §9, verbatim. */
export const DEFAULT_MODELS: ModelsConfig = {
  tiers: {
    fast: [{ model: 'gpt-6-luna' }, { model: 'gpt-5.6-luna' }],
    standard: [{ model: 'gpt-6.1-sol' }, { model: 'gpt-6-sol' }, { model: 'gpt-5.6-sol' }, { model: 'gpt-5.6-terra' }],
    deep: [{ model: 'gpt-6-astra' }, { model: 'gpt-6.1-sol', effort: 'high' }],
  },
  efforts: {
    indexer: 'medium',
    glossary: 'low',
    'book-summary': 'low',
    planner: 'medium',
    'extractor.graph': 'medium',
    'extractor.mermaid': 'medium',
    'extractor.template': 'medium',
    'extractor.chart': 'low',
    'extractor.math': 'low',
    'extractor.timeline': 'medium',
    animator: 'medium',
    translator: 'high',
    'trace-fixer': 'medium',
    patcher: 'medium',
    critic: 'low',
    repair: 'medium',
    'html-fallback': 'medium',
  },
  escalationEffort: { default: 'medium', translator: 'high' },
  allowedEfforts: ['low', 'medium', 'high'],
  allowlist: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  roleOverrides: {},
}

/**
 * Parses `ILLUS_MODELS_JSON`. Top-level keys given replace the default's keys (shallow merge), so
 * `{"roleOverrides": {...}}` alone is valid. Throws with every problem listed when invalid.
 */
export function loadModelsConfig(json: string | undefined): ModelsConfig {
  if (!json?.trim()) return DEFAULT_MODELS
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (e) {
    throw new Error(`ILLUS_MODELS_JSON is not valid JSON: ${(e as Error).message}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ILLUS_MODELS_JSON must be a JSON object')
  const parsed = ModelsConfig.safeParse({ ...DEFAULT_MODELS, ...raw })
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`ILLUS_MODELS_JSON is invalid:\n${lines.join('\n')}`)
  }
  return parsed.data
}

/** One model to try, with the effort that is always sent explicitly. */
export interface ModelRun {
  model: string
  effort: ReasoningEffort
}

/** Ordered chain for one call: the primary first, then fallbacks for unavailable models only (§9). */
export interface Route {
  tier: Tier
  chain: ModelRun[]
}

/**
 * Tier → model chain with explicit efforts for a role. Escalated calls use the role's escalation tier
 * at the escalation effort; an entry's own `effort` (e.g. deep's `gpt-6.1-sol` at `high`) wins.
 */
export function resolveRoute(config: ModelsConfig, role: RoleName, escalate = false): Route {
  const spec = ROLES[role]
  const override = config.roleOverrides[role]
  const escalationTier = override?.escalationTier ?? ('escalationTier' in spec ? spec.escalationTier : undefined)
  if (escalate && !escalationTier) throw new Error(`role ${role} has no escalation tier`)
  const tier = escalate ? escalationTier! : (override?.tier ?? spec.tier)
  const effort: ReasoningEffort = escalate
    ? (config.escalationEffort[role] ?? config.escalationEffort.default!)
    : (override?.effort ?? config.efforts[role] ?? spec.effort)
  const entries = !escalate && override?.models ? override.models : config.tiers[tier]
  const allow = new Set(config.allowlist)
  const chain = entries.map((e) => {
    if (!allow.has(e.model)) throw new Error(`model ${e.model} is not on the allowlist`)
    return { model: e.model, effort: e.effort ?? effort }
  })
  return { tier, chain }
}
