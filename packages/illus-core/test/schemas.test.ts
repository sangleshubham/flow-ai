import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import * as core from '../src/index.ts'
import {
  ACTION_OPS,
  Action,
  AnimationIR,
  ChartIR,
  ConceptModel,
  criticPasses,
  Evidence,
  FrameState,
  GraphIR,
  IR,
  LlmRequest,
  PlanItem,
  ROLES,
  RoleName,
  SCHEMAS,
  SchemaName,
  Target,
  VisualPlan,
  emptyFrame,
  roleAllowsSchema,
} from '../src/index.ts'
import { buildAllIRs, make } from '../src/testing/index.ts'

// Every factory, paired with the exported schema of the same name.
const FACTORY_SCHEMAS: [keyof typeof make, string][] = [
  ['evidence', 'Evidence'],
  ['block', 'Block'],
  ['sectionNode', 'SectionNode'],
  ['crossRef', 'CrossRef'],
  ['bookSummary', 'BookSummary'],
  ['bookMeta', 'BookMeta'],
  ['sectionIndexOutput', 'SectionIndexOutput'],
  ['sectionIndex', 'SectionIndex'],
  ['sectionIndexRecord', 'SectionIndexRecord'],
  ['indexerOutput', 'IndexerOutput'],
  ['concept', 'Concept'],
  ['conceptMerge', 'ConceptMerge'],
  ['glossaryOutput', 'GlossaryOutput'],
  ['planItem', 'PlanItem'],
  ['visualPlan', 'VisualPlan'],
  ['planRecord', 'PlanRecord'],
  ['graphIR', 'GraphIR'],
  ['sequenceIR', 'SequenceIR'],
  ['stateIR', 'StateIR'],
  ['classIR', 'ClassIR'],
  ['erIR', 'ErIR'],
  ['templateIR', 'TemplateIR'],
  ['chartIR', 'ChartIR'],
  ['mathIR', 'MathIR'],
  ['timelineIR', 'TimelineIR'],
  ['htmlIR', 'HtmlIR'],
  ['step', 'Step'],
  ['animationIR', 'AnimationIR'],
  ['frameState', 'FrameState'],
  ['translation', 'Translation'],
  ['traceStep', 'TraceStep'],
  ['rawTrace', 'RawTrace'],
  ['trace', 'Trace'],
  ['scenarioTrace', 'ScenarioTrace'],
  ['traceRecord', 'TraceRecord'],
  ['patchOutput', 'PatchOutput'],
  ['patch', 'Patch'],
  ['conceptModel', 'ConceptModel'],
  ['validationReport', 'ValidationReport'],
  ['criticReport', 'CriticReport'],
  ['elementReport', 'ElementReport'],
  ['visualRecord', 'VisualRecord'],
  ['llmLogEntry', 'LlmLogEntry'],
  ['settingRecord', 'SettingRecord'],
  ['llmRequest', 'LlmRequest'],
  ['llmResponse', 'LlmResponse'],
  ['themeTokens', 'ThemeTokens'],
]

const exported = core as unknown as Record<string, unknown>

describe('factories and schema round-trip', () => {
  it.each(FACTORY_SCHEMAS)('make.%s() survives parse → JSON → parse unchanged (%s)', (factory, schemaName) => {
    const schema = exported[schemaName] as z.ZodType
    expect(schema, `${schemaName} is exported`).toBeInstanceOf(z.ZodType)
    const value = (make[factory] as () => unknown)()
    const once = schema.parse(value)
    const twice = schema.parse(JSON.parse(JSON.stringify(once)))
    expect(twice).toEqual(once)
    expect(once).toEqual(value)
  })

  it('has a factory for every exported Zod schema', () => {
    const covered = new Set(FACTORY_SCHEMAS.map(([, s]) => s))
    // Enums, primitives and building blocks covered through their parents.
    const parts = new Set([
      'IrId', 'Label', 'Sha256Hex', 'Timestamp', 'ReasoningEffort', 'Tier', 'ProducedWith', 'BlockKind',
      'SectionLevel', 'IndexStatus', 'SectionFlags', 'VisualKind', 'TemplateId', 'ConceptModelKind',
      'GraphNodeShape', 'GraphNode', 'GraphEdge', 'GraphGroup', 'SequenceParticipant', 'SequenceMessage',
      'StateNode', 'StateTransition', 'Visibility', 'ClassField', 'ClassMethod', 'ClassNode',
      'ClassCardinality', 'ClassRelation', 'ErAttribute', 'ErEntity', 'ErCardinality', 'ErRelationship',
      'TemplateEvidence', 'ChartFn', 'ChartSeries', 'MathTerm', 'TimelineLane', 'TimelineEvent', 'IR',
      'Target', 'HighlightTone', 'Action', 'ValueRef', 'HeapObj', 'PatchOp', 'ValidationLayer',
      'ValidationIssue', 'LlmOutcome', 'SchemaName', 'RoleName', 'LlmImage', 'LlmUsage', 'LlmErrorCode',
      'FlagName', 'FlagOverrides',
    ])
    const missing = Object.entries(exported)
      .filter(([name, v]) => v instanceof z.ZodType && !covered.has(name) && !parts.has(name))
      .map(([name]) => name)
    expect(missing).toEqual([])
  })

  it('builds a valid IR of every kind', () => {
    const kinds = buildAllIRs().map((ir) => IR.parse(ir).type)
    expect(kinds.sort()).toEqual(['chart', 'class', 'er', 'graph', 'html', 'math', 'sequence', 'state', 'template', 'timeline'])
  })
})

describe('role and schema registries', () => {
  it('maps every SchemaName to a schema and back', () => {
    expect(Object.keys(SCHEMAS).sort()).toEqual([...SchemaName.options].sort())
  })

  it('gives every role a tier, an allowed effort and known schemas', () => {
    expect(Object.keys(ROLES).sort()).toEqual([...RoleName.options].sort())
    for (const [role, spec] of Object.entries(ROLES)) {
      expect(['low', 'medium', 'high'], role).toContain(spec.effort)
      for (const s of spec.schemas) expect(SchemaName.options, role).toContain(s)
    }
  })

  it.each(SchemaName.options)('%s converts to JSON Schema with an object root (structured outputs)', (name) => {
    const json = z.toJSONSchema(SCHEMAS[name], { unrepresentable: 'any' }) as { type?: string }
    expect(json.type).toBe('object')
  })

  it('checks that a request names one of its role’s schemas', () => {
    expect(roleAllowsSchema('extractor.mermaid', 'StateIR')).toBe(true)
    expect(LlmRequest.safeParse({ ...make.llmRequest(), schemaName: 'GraphIR' }).success).toBe(false)
    expect(LlmRequest.safeParse({ ...make.llmRequest(), role: 'extractor.template', schemaName: 'TemplateIR' }).success).toBe(false)
    expect(LlmRequest.safeParse({ ...make.llmRequest(), role: 'extractor.template', schemaName: 'TemplateIR', templateId: 'tree' }).success).toBe(true)
  })
})

describe('schema limits from the spec', () => {
  const longQuote = Array.from({ length: 31 }, (_, i) => `w${i}`).join(' ')

  it('limits evidence quotes to 30 words', () => {
    expect(Evidence.safeParse({ blockId: 'b', quote: longQuote }).success).toBe(false)
    expect(Evidence.safeParse({ blockId: 'b', quote: longQuote.split(' ').slice(0, 30).join(' ') }).success).toBe(true)
  })

  it('limits labels to 40 characters and ids to slugs', () => {
    const node = make.graphIR().nodes[0]!
    expect(GraphIR.safeParse({ ...make.graphIR(), nodes: [{ ...node, label: 'x'.repeat(41) }] }).success).toBe(false)
    expect(GraphIR.safeParse({ ...make.graphIR(), nodes: [{ ...node, id: 'has space' }] }).success).toBe(false)
  })

  it('limits graphs to 12 nodes and 18 edges', () => {
    const node = make.graphIR().nodes[0]!
    const edge = make.graphIR().edges[0]!
    const nodes = (n: number) => Array.from({ length: n }, (_, i) => ({ ...node, id: `n${i}` }))
    const edges = (n: number) => Array.from({ length: n }, (_, i) => ({ ...edge, id: `e${i}` }))
    expect(GraphIR.safeParse({ ...make.graphIR(), nodes: nodes(12), edges: edges(18) }).success).toBe(true)
    expect(GraphIR.safeParse({ ...make.graphIR(), nodes: nodes(13) }).success).toBe(false)
    expect(GraphIR.safeParse({ ...make.graphIR(), edges: edges(19) }).success).toBe(false)
  })

  it('enforces plan rules: ≤ 3 items, needsVisual consistency, kind-specific fields', () => {
    expect(VisualPlan.safeParse({ ...make.visualPlan(), needsVisual: false }).success).toBe(false)
    expect(VisualPlan.safeParse({ ...make.visualPlan(), needsVisual: false, items: [] }).success).toBe(true)
    expect(VisualPlan.safeParse({ ...make.visualPlan(), items: [] }).success).toBe(false)
    const items = [1, 2, 3, 4].map((n) => make.planItem({ planItemId: `p${n}` }))
    expect(VisualPlan.safeParse({ ...make.visualPlan(), items }).success).toBe(false)
    expect(PlanItem.safeParse({ ...make.planItem(), kind: 'template' }).success).toBe(false)
    expect(PlanItem.safeParse({ ...make.planItem(), kind: 'trace' }).success).toBe(false)
    expect(PlanItem.safeParse({ ...make.planItem(), kind: 'chart', newConceptModel: 'c' }).success).toBe(false)
    expect(PlanItem.safeParse({ ...make.planItem(), intent: Array(26).fill('word').join(' ') }).success).toBe(false)
  })

  it('requires exactly one of fn or points per chart series', () => {
    const s = make.chartIR().series[0]!
    expect(ChartIR.safeParse({ ...make.chartIR(), series: [{ ...s, points: [[1, 2]] }] }).success).toBe(false)
    expect(ChartIR.safeParse({ ...make.chartIR(), series: [{ name: 'm', evidence: s.evidence }] }).success).toBe(false)
  })

  it('accepts only the §11 target forms', () => {
    for (const t of ['node:a', 'edge:e1', 'group:g', 'msg:m1', 'cell:arr[3]', 'item:x']) expect(Target.safeParse(t).success, t).toBe(true)
    for (const t of ['a', 'node:', 'cell:arr[x]', 'cell:arr', 'box:a']) expect(Target.safeParse(t).success, t).toBe(false)
  })

  it('knows every action op and rejects unknown ones', () => {
    const fromSchema = Action.options.flatMap((o) => o.shape.op.values ? [...o.shape.op.values] : [])
    expect([...ACTION_OPS].sort()).toEqual([...new Set(fromSchema)].sort())
    expect(Action.safeParse({ op: 'teleport', target: 'node:a' }).success).toBe(false)
    expect(Action.safeParse({ op: 'enqueue', container: 'q', id: 'x', value: 3 }).success).toBe(true)
  })

  it('needs 2–40 animation steps with ≤ 6 actions and ≤ 140-char narration', () => {
    const anim = make.animationIR()
    expect(AnimationIR.safeParse({ ...anim, steps: anim.steps.slice(0, 1) }).success).toBe(false)
    const step = anim.steps[0]!
    expect(AnimationIR.safeParse({ ...anim, steps: [step, { ...step, narration: 'x'.repeat(141) }] }).success).toBe(false)
    const actions = Array(7).fill({ op: 'focus', target: 'all' })
    expect(AnimationIR.safeParse({ ...anim, steps: [step, { ...step, actions }] }).success).toBe(false)
  })

  it('has an empty base frame', () => {
    expect(FrameState.parse(emptyFrame(['node:a']))).toMatchObject({ step: 0, hidden: ['node:a'], focus: null })
  })

  it('keeps concept-model patches sorted by section ordinal', () => {
    const p = make.patch()
    expect(ConceptModel.safeParse({ ...make.conceptModel(), patches: [{ ...p, sectionOrdinal: 5 }, p] }).success).toBe(false)
  })

  it('applies the §16 critic pass rule', () => {
    expect(criticPasses(make.criticReport())).toBe(true)
    expect(criticPasses(make.criticReport({ scores: { legibility: 2, intentMatch: 5, clutter: 5 } }))).toBe(false)
    expect(criticPasses(make.criticReport({ issues: [{ kind: 'mislabel', note: 'x' }] }))).toBe(false)
  })
})

describe('contracts v1.1 and v1.2 amendments (ADR 0008)', () => {
  it('reports version 1.2.0', () => {
    expect(core.CONTRACTS_VERSION).toBe('1.2.0')
  })

  it('grounds quotes in code blocks whatever their whitespace (code text keeps its layout)', () => {
    const code = 'def total(xs):\n    s = 0\n    for x in xs:\n        s += x\n    return s'
    expect(core.Block.parse(make.block({ kind: 'code', text: code, code: { source: code, langHint: 'python' } })).text).toBe(code)
    expect(core.findQuote(code, 'for x in xs: s += x')).not.toBeNull()
    expect(core.findQuote(code, 'for x in xs:\n        s += x')).not.toBeNull()
  })

  it('stores null or the IR as VisualRecord.spec, with the layout beside it', () => {
    const ir = make.graphIR()
    expect(core.VisualRecord.parse(make.visualRecord({ spec: null })).spec).toBeNull()
    expect(core.VisualRecord.parse(make.visualRecord({ spec: ir, layout: { nodes: {} } })).spec).toEqual(ir)
  })

  it('lets a template drop one element by evidence path without mutating its props', () => {
    const props = z.object({ items: z.array(z.number()) })
    const spec: core.TemplateSpec<z.infer<typeof props>> = {
      id: 'array',
      description: 'array',
      whenToUse: 'arrays',
      propsSchema: props,
      example: { items: [1, 2, 3] },
      supportedActions: ['highlight'],
      dropElement: (p, path) => ({ items: p.items.filter((_, i) => `items.${i}` !== path) }),
    }
    const before = { items: [1, 2, 3] }
    expect(spec.dropElement?.(before, 'items.1')).toEqual({ items: [1, 3] })
    expect(before.items).toEqual([1, 2, 3])
  })
})
