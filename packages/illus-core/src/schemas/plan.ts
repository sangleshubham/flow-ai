import { z } from 'zod'

import { maxWords, ReasoningEffort, Timestamp } from './common.ts'

/** The visual families a plan item can request (§5, kind guide in §8). */
export const VisualKind = z.enum([
  'graph',
  'sequence',
  'state',
  'class',
  'er',
  'template',
  'chart',
  'math',
  'trace',
  'timeline',
  'html',
])
export type VisualKind = z.infer<typeof VisualKind>

/** The 16 templates of the template library (§10). */
export const TemplateId = z.enum([
  'array',
  'linked-list',
  'stack',
  'queue',
  'hash-table',
  'tree',
  'graph-ds',
  'grid',
  'memory',
  'bits',
  'call-tree',
  'pipeline',
  'layers',
  'cache',
  'comparison',
  'set-ops',
])
export type TemplateId = z.infer<typeof TemplateId>

/** Kinds that may extend or start a concept model in v1 (§13). */
export const ConceptModelKind = VisualKind.extract(['graph', 'sequence', 'state'])
export type ConceptModelKind = z.infer<typeof ConceptModelKind>

/** One visual the planner wants for a section (§5). */
export const PlanItem = z
  .object({
    planItemId: z.string().min(1),
    kind: VisualKind,
    templateId: TemplateId.optional(),
    intent: maxWords(25),
    conceptIds: z.array(z.string().min(1)),
    codeBlockId: z.string().min(1).optional(),
    conceptModelId: z.string().min(1).optional(),
    /** conceptId of a concept model to start with this item. */
    newConceptModel: z.string().min(1).optional(),
    priority: z.literal([1, 2, 3]),
    animate: z.boolean(),
  })
  .superRefine((item, ctx) => {
    if (item.kind === 'template' && !item.templateId)
      ctx.addIssue({ code: 'custom', path: ['templateId'], message: 'template items need a templateId' })
    if (item.kind !== 'template' && item.templateId)
      ctx.addIssue({ code: 'custom', path: ['templateId'], message: 'templateId is only for template items' })
    if (item.kind === 'trace' && !item.codeBlockId)
      ctx.addIssue({ code: 'custom', path: ['codeBlockId'], message: 'trace items need a codeBlockId' })
    if (item.conceptModelId && item.newConceptModel)
      ctx.addIssue({
        code: 'custom',
        path: ['newConceptModel'],
        message: 'set either conceptModelId or newConceptModel, not both',
      })
    if ((item.conceptModelId || item.newConceptModel) && !ConceptModelKind.safeParse(item.kind).success)
      ctx.addIssue({
        code: 'custom',
        path: ['kind'],
        message: 'concept models support graph, sequence and state only',
      })
  })
export type PlanItem = z.infer<typeof PlanItem>

/** Output of the `planner` role (§5, §8 stage 1): at most 3 items, none when no visual is needed. */
export const VisualPlan = z
  .object({
    sectionId: z.string().min(1),
    needsVisual: z.boolean(),
    reason: z.string().min(1),
    items: z.array(PlanItem).max(3),
  })
  .superRefine((plan, ctx) => {
    if (plan.needsVisual && plan.items.length === 0)
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'needsVisual: true requires at least one item' })
    if (!plan.needsVisual && plan.items.length > 0)
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'needsVisual: false must have no items' })
    const ids = plan.items.map((i) => i.planItemId)
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'planItemIds must be unique' })
  })
export type VisualPlan = z.infer<typeof VisualPlan>

/** Record of the `plans` store (§5), keyed by the plan cache key. */
export const PlanRecord = z.object({
  cacheKey: z.string().min(1),
  bookId: z.string().min(1),
  sectionId: z.string().min(1),
  plan: VisualPlan,
  /** The concept index was still missing after 20 s, so the plan used partial context (§15 step 2). */
  partialContext: z.boolean(),
  model: z.string().min(1),
  effort: ReasoningEffort,
  promptVersion: z.string().min(1),
  usageTokens: z.number().int().nonnegative(),
  createdAt: Timestamp,
  stale: z.boolean(),
})
export type PlanRecord = z.infer<typeof PlanRecord>
