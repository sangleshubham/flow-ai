// Role and schema registries plus the /api/llm wire contract (§9).
import { z } from 'zod'

import { ReasoningEffort } from './common.ts'
import type { Tier } from './common.ts'
import { AnimationIR } from './animation.ts'
import { BookSummary } from './book.ts'
import { GlossaryOutput, IndexerOutput } from './concepts.ts'
import { PatchOutput } from './concept-model.ts'
import {
  ChartIR,
  ClassIR,
  ErIR,
  GraphIR,
  GraphSource,
  HtmlIR,
  MathIR,
  SequenceIR,
  StateIR,
  TemplateIR,
  TimelineIR,
} from './ir.ts'
import { TemplateId, VisualPlan } from './plan.ts'
import { CriticReport } from './quality.ts'
import { Translation } from './trace.ts'

/** Every model output schema, by name. The gateway resolves `schemaName` through this map (§9). */
export const SCHEMAS = {
  IndexerOutput,
  GlossaryOutput,
  BookSummary,
  VisualPlan,
  GraphSource,
  GraphIR,
  SequenceIR,
  StateIR,
  ClassIR,
  ErIR,
  TemplateIR,
  ChartIR,
  MathIR,
  TimelineIR,
  HtmlIR,
  AnimationIR,
  Translation,
  PatchOutput,
  CriticReport,
} as const

export const SchemaName = z.enum([
  'IndexerOutput',
  'GlossaryOutput',
  'BookSummary',
  'VisualPlan',
  'GraphSource',
  'GraphIR',
  'SequenceIR',
  'StateIR',
  'ClassIR',
  'ErIR',
  'TemplateIR',
  'ChartIR',
  'MathIR',
  'TimelineIR',
  'HtmlIR',
  'AnimationIR',
  'Translation',
  'PatchOutput',
  'CriticReport',
])
export type SchemaName = z.infer<typeof SchemaName>

/** Parsed output type of a schema name. */
export type SchemaOutput<S extends SchemaName> = z.infer<typeof SCHEMAS[S]>

export const RoleName = z.enum([
  'indexer',
  'glossary',
  'book-summary',
  'planner',
  'extractor.graph',
  'extractor.mermaid',
  'extractor.template',
  'extractor.chart',
  'extractor.math',
  'extractor.timeline',
  'animator',
  'translator',
  'trace-fixer',
  'patcher',
  'critic',
  'repair',
  'html-fallback',
])
export type RoleName = z.infer<typeof RoleName>

export interface RoleSpec {
  /** Tier the role runs on. */
  readonly tier: Tier
  /** Tier used when `escalate: true`; absent when the role never escalates. */
  readonly escalationTier?: Tier
  /** Default reasoning effort (§9 roles table; overridable through `ILLUS_MODELS_JSON`). */
  readonly effort: ReasoningEffort
  /** Output schemas the role may be asked for; the first is the default. */
  readonly schemas: readonly SchemaName[]
  /** The role sends an image (critic only). */
  readonly image?: boolean
}

const IR_SCHEMAS = [
  'GraphIR',
  'SequenceIR',
  'StateIR',
  'ClassIR',
  'ErIR',
  'TemplateIR',
  'ChartIR',
  'MathIR',
  'TimelineIR',
] as const

// Identity helper instead of `satisfies`: Next 12's SWC cannot parse `satisfies` (ADR 0009).
const checkRoles = <T extends Record<RoleName, RoleSpec>>(roles: T): T => roles

/** The §9 roles table. Owners of each prompt are listed in CLAUDE.md. */
export const ROLES = checkRoles({
  indexer: {
    tier: 'fast',
    escalationTier: 'standard',
    effort: 'low',
    schemas: ['IndexerOutput'],
  },
  glossary: { tier: 'fast', effort: 'low', schemas: ['GlossaryOutput'] },
  'book-summary': { tier: 'fast', effort: 'medium', schemas: ['BookSummary'] },
  planner: {
    tier: 'standard',
    escalationTier: 'deep',
    effort: 'medium',
    schemas: ['VisualPlan'],
  },
  'extractor.graph': {
    tier: 'standard',
    escalationTier: 'deep',
    effort: 'medium',
    // GraphSource since prompt 2.0.0 (ADR 0049); GraphIR stays accepted for older callers.
    schemas: ['GraphSource', 'GraphIR'],
  },
  'extractor.mermaid': {
    tier: 'standard',
    escalationTier: 'deep',
    effort: 'medium',
    schemas: ['SequenceIR', 'StateIR', 'ClassIR', 'ErIR'],
  },
  'extractor.template': {
    tier: 'standard',
    escalationTier: 'deep',
    effort: 'medium',
    schemas: ['TemplateIR'],
  },
  'extractor.chart': { tier: 'standard', effort: 'low', schemas: ['ChartIR'] },
  'extractor.math': { tier: 'standard', effort: 'low', schemas: ['MathIR'] },
  'extractor.timeline': {
    tier: 'standard',
    escalationTier: 'deep',
    effort: 'medium',
    schemas: ['TimelineIR'],
  },
  animator: {
    tier: 'standard',
    escalationTier: 'deep',
    effort: 'medium',
    schemas: ['AnimationIR'],
  },
  translator: {
    tier: 'standard',
    escalationTier: 'deep',
    effort: 'high',
    schemas: ['Translation'],
  },
  'trace-fixer': {
    tier: 'standard',
    effort: 'medium',
    schemas: ['Translation'],
  },
  patcher: {
    tier: 'standard',
    escalationTier: 'deep',
    effort: 'medium',
    schemas: ['PatchOutput'],
  },
  critic: {
    tier: 'standard',
    effort: 'low',
    schemas: ['CriticReport'],
    image: true,
  },
  repair: {
    tier: 'standard',
    effort: 'medium',
    schemas: [...IR_SCHEMAS, 'AnimationIR'],
  },
  'html-fallback': { tier: 'standard', effort: 'medium', schemas: ['HtmlIR'] },
} as const)

/** Effort of escalated calls: `deep` tier at `high` for every role (§9, ADR 0046). */
export function escalationEffort(_role: RoleName): ReasoningEffort {
  return 'high'
}

/** Schema names a role may return. */
export type RoleSchemaName<R extends RoleName> =
  typeof ROLES[R]['schemas'][number]

/** Parsed output of a role (union when the role has several schemas). */
export type RoleOutput<R extends RoleName> = SchemaOutput<RoleSchemaName<R>>

/** True when `schemaName` is one the role may return. */
export function roleAllowsSchema(
  role: RoleName,
  schemaName: SchemaName,
): boolean {
  return (ROLES[role].schemas as readonly SchemaName[]).includes(schemaName)
}

// ---------------------------------------------------------------- wire contract of /api/llm

export const LlmImage = z.object({
  mediaType: z.literal('image/png'),
  base64: z.string().min(1),
})
export type LlmImage = z.infer<typeof LlmImage>

/** Request body of `POST /api/llm` (§9). */
export const LlmRequest = z
  .object({
    role: RoleName,
    promptVersion: z.string().min(1),
    prefix: z.string(),
    body: z.string(),
    schemaName: SchemaName,
    /** For `TemplateIR`: the server validates `props` with this template's schema (ADR 0003). */
    templateId: TemplateId.optional(),
    /** Critic only. */
    image: LlmImage.optional(),
    /** Use the role's escalation tier. */
    escalate: z.boolean().optional(),
    requestId: z.string().min(1),
  })
  .refine((r) => roleAllowsSchema(r.role, r.schemaName), {
    message: 'schemaName is not one of the role’s schemas',
    path: ['schemaName'],
  })
  .refine((r) => r.schemaName !== 'TemplateIR' || r.templateId !== undefined, {
    message: 'TemplateIR requests need templateId',
    path: ['templateId'],
  })
export type LlmRequest = z.infer<typeof LlmRequest>

export const LlmUsage = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cachedInput: z.number().int().nonnegative(),
})
export type LlmUsage = z.infer<typeof LlmUsage>

/** Error codes of the gateway (§9). */
export const LlmErrorCode = z.enum([
  'auth',
  'signin-required',
  'plan-limit',
  'schema',
  'upstream',
  'timeout',
])
export type LlmErrorCode = z.infer<typeof LlmErrorCode>

/** Response body of `POST /api/llm` (§9). `effort` is the effort actually sent (ADR 0003). */
export const LlmResponse = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    data: z.unknown(),
    usage: LlmUsage,
    model: z.string().min(1),
    effort: ReasoningEffort,
    latencyMs: z.number().nonnegative(),
  }),
  z.object({
    ok: z.literal(false),
    code: LlmErrorCode,
    message: z.string(),
    retryAfterMs: z.number().int().nonnegative().optional(),
    /** Zod issues when `code` is `schema`, so the client can run one repair call. */
    issues: z.array(z.unknown()).optional(),
  }),
])
export type LlmResponse = z.infer<typeof LlmResponse>

/** Error thrown by `LlmCall.call`. `aborted` is client-side only (the caller's AbortSignal fired). */
export class LlmError extends Error {
  readonly code: LlmErrorCode | 'aborted'
  readonly retryAfterMs: number | undefined
  readonly issues: unknown[] | undefined

  constructor(
    code: LlmErrorCode | 'aborted',
    message: string,
    extra: { retryAfterMs?: number; issues?: unknown[] } = {},
  ) {
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.retryAfterMs = extra.retryAfterMs
    this.issues = extra.issues
  }
}
