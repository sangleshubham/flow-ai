// Grounded, renderer-agnostic IR produced by the extractor roles (§5, §8). Every element carries
// verbatim evidence. Size limits are hard limits from §8; cross-element rules (endpoints exist, unique
// ids, …) are the structural validators' job (§16, @illus/core/validate), not the schema's.
import { z } from 'zod'

import { Evidence, IrId, Label } from './common.ts'
import { TemplateId } from './plan.ts'

// ---------------------------------------------------------------- graph

export const GraphNodeShape = z.enum(['box', 'store', 'actor', 'queue', 'decision', 'note'])
export type GraphNodeShape = z.infer<typeof GraphNodeShape>

/**
 * Icon drawn above a node's label or beside a group's (ADR 0049). One of `GRAPH_ICONS`; unknown names are
 * not a schema error so an icon catalog change never invalidates stored visuals, the renderer skips them.
 */
export const GraphIcon = z.string().regex(/^[a-z0-9-]{1,40}$/, 'must be an icon name such as "database"')
export type GraphIcon = z.infer<typeof GraphIcon>

/** Accent colour of a node or group (ADR 0049); themed by the renderer. */
export const GraphColor = z.enum(['blue', 'green', 'orange', 'red', 'purple', 'gray'])
export type GraphColor = z.infer<typeof GraphColor>

export const GraphNode = z.object({
  id: IrId,
  label: Label,
  sublabel: Label.optional(),
  group: IrId.optional(),
  shape: GraphNodeShape,
  icon: GraphIcon.optional(),
  color: GraphColor.optional(),
  evidence: Evidence,
})
export type GraphNode = z.infer<typeof GraphNode>

export const GraphEdge = z.object({
  id: IrId,
  from: IrId,
  to: IrId,
  label: Label.optional(),
  style: z.enum(['solid', 'dashed']),
  evidence: Evidence,
})
export type GraphEdge = z.infer<typeof GraphEdge>

export const GraphGroup = z.object({
  id: IrId,
  label: Label,
  parent: IrId.optional(),
  icon: GraphIcon.optional(),
  color: GraphColor.optional(),
  evidence: Evidence,
})
export type GraphGroup = z.infer<typeof GraphGroup>

/** Components and what calls what; layered with ELK (§8, §10). ≤ 12 nodes, ≤ 18 edges. */
export const GraphIR = z.object({
  type: z.literal('graph'),
  title: z.string().min(1),
  direction: z.enum(['LR', 'TB']),
  nodes: z.array(GraphNode).max(12),
  edges: z.array(GraphEdge).max(18),
  groups: z.array(GraphGroup),
})
export type GraphIR = z.infer<typeof GraphIR>

/**
 * What the graph extractor returns (ADR 0049): the diagram as a short Eraser-style source text that
 * `parseGraphSource` (@illus/core compile) turns into a `GraphIR`, which is then validated like any IR.
 */
export const GraphSource = z.object({
  source: z
    .string()
    .min(1)
    .max(8000)
    .describe('The diagram in the graph diagram language, one statement per line.'),
})
export type GraphSource = z.infer<typeof GraphSource>

// ---------------------------------------------------------------- sequence

export const SequenceParticipant = z.object({ id: IrId, label: Label, evidence: Evidence })
export type SequenceParticipant = z.infer<typeof SequenceParticipant>

export const SequenceMessage = z.object({
  id: IrId,
  from: IrId,
  to: IrId,
  label: Label,
  kind: z.enum(['sync', 'async', 'reply']),
  evidence: Evidence,
})
export type SequenceMessage = z.infer<typeof SequenceMessage>

/** Messages between parties over time; Mermaid (§8). ≤ 6 participants, ≤ 20 messages. */
export const SequenceIR = z.object({
  type: z.literal('sequence'),
  title: z.string().min(1),
  participants: z.array(SequenceParticipant).max(6),
  messages: z.array(SequenceMessage).max(20),
})
export type SequenceIR = z.infer<typeof SequenceIR>

// ---------------------------------------------------------------- state

export const StateNode = z.object({ id: IrId, label: Label, evidence: Evidence })
export type StateNode = z.infer<typeof StateNode>

export const StateTransition = z.object({
  id: IrId,
  from: IrId,
  to: IrId,
  event: Label,
  guard: Label.optional(),
  evidence: Evidence,
})
export type StateTransition = z.infer<typeof StateTransition>

/** Modes, lifecycles, transitions on events; Mermaid (§8). ≤ 10 states. */
export const StateIR = z.object({
  type: z.literal('state'),
  title: z.string().min(1),
  initial: IrId,
  final: z.array(IrId),
  states: z.array(StateNode).max(10),
  transitions: z.array(StateTransition),
})
export type StateIR = z.infer<typeof StateIR>

// ---------------------------------------------------------------- class

/** UML visibility marker as Mermaid writes it: + public, - private, # protected, ~ package. */
export const Visibility = z.enum(['+', '-', '#', '~'])
export type Visibility = z.infer<typeof Visibility>

export const ClassField = z.object({
  name: Label,
  type: Label.optional(),
  visibility: Visibility.optional(),
  isStatic: z.boolean().optional(),
  evidence: Evidence,
})
export type ClassField = z.infer<typeof ClassField>

export const ClassMethod = z.object({
  name: Label,
  /** Parameter list as written in the book, e.g. 'key: K, value: V'. */
  params: z.string().max(80).optional(),
  returns: Label.optional(),
  visibility: Visibility.optional(),
  isStatic: z.boolean().optional(),
  isAbstract: z.boolean().optional(),
  evidence: Evidence,
})
export type ClassMethod = z.infer<typeof ClassMethod>

export const ClassNode = z.object({
  id: IrId,
  label: Label,
  stereotype: z.enum(['interface', 'abstract', 'enumeration', 'service']).optional(),
  fields: z.array(ClassField).max(8),
  methods: z.array(ClassMethod).max(8),
  evidence: Evidence,
})
export type ClassNode = z.infer<typeof ClassNode>

/** Multiplicity at one end of a class relation (the allowed set of §16 "Class / ER"). */
export const ClassCardinality = z.enum(['1', '0..1', '0..*', '1..*', '*', 'n'])
export type ClassCardinality = z.infer<typeof ClassCardinality>

export const ClassRelation = z.object({
  id: IrId,
  from: IrId,
  to: IrId,
  kind: z.enum(['inheritance', 'realization', 'composition', 'aggregation', 'association', 'dependency']),
  label: Label.optional(),
  fromCardinality: ClassCardinality.optional(),
  toCardinality: ClassCardinality.optional(),
  evidence: Evidence,
})
export type ClassRelation = z.infer<typeof ClassRelation>

/** Types, inheritance, composition; Mermaid classDiagram (§8). ≤ 12 classes, ≤ 18 relations (ADR 0003). */
export const ClassIR = z.object({
  type: z.literal('class'),
  title: z.string().min(1),
  classes: z.array(ClassNode).max(12),
  relations: z.array(ClassRelation).max(18),
})
export type ClassIR = z.infer<typeof ClassIR>

// ---------------------------------------------------------------- er

export const ErAttribute = z.object({
  name: Label,
  type: Label.optional(),
  key: z.enum(['PK', 'FK', 'UK']).optional(),
  evidence: Evidence,
})
export type ErAttribute = z.infer<typeof ErAttribute>

export const ErEntity = z.object({
  id: IrId,
  label: Label,
  attributes: z.array(ErAttribute).max(12),
  evidence: Evidence,
})
export type ErEntity = z.infer<typeof ErEntity>

/** Cardinality at one end of an ER relationship (Mermaid crow's foot: |o, ||, }o, }|). */
export const ErCardinality = z.enum(['zero-or-one', 'exactly-one', 'zero-or-more', 'one-or-more'])
export type ErCardinality = z.infer<typeof ErCardinality>

export const ErRelationship = z.object({
  id: IrId,
  from: IrId,
  to: IrId,
  fromCardinality: ErCardinality,
  toCardinality: ErCardinality,
  /** Mermaid requires a relationship label. */
  label: Label,
  /** Solid line when true, dashed (non-identifying) when false. */
  identifying: z.boolean(),
  evidence: Evidence,
})
export type ErRelationship = z.infer<typeof ErRelationship>

/** Tables, keys, relationships in a data model; Mermaid erDiagram (§8). ≤ 12 entities, ≤ 18 relationships. */
export const ErIR = z.object({
  type: z.literal('er'),
  title: z.string().min(1),
  entities: z.array(ErEntity).max(12),
  relationships: z.array(ErRelationship).max(18),
})
export type ErIR = z.infer<typeof ErIR>

// ---------------------------------------------------------------- template

/** Evidence for one element of a template's props, addressed by element path, e.g. 'nodes.3' (§5). */
export const TemplateEvidence = z.object({
  path: z.string().min(1),
  evidence: Evidence,
})
export type TemplateEvidence = z.infer<typeof TemplateEvidence>

/**
 * Data-structure template instance (§5, §10). `props` is validated by the template's own schema from
 * the template registry. `evidence` is a list keyed by element path instead of the spec's
 * `Record<string, Evidence>` so it fits strict structured outputs (ADR 0003).
 */
export const TemplateIR = z.object({
  type: z.literal('template'),
  templateId: TemplateId,
  props: z.unknown(),
  evidence: z.array(TemplateEvidence),
})
export type TemplateIR = z.infer<typeof TemplateIR>

// ---------------------------------------------------------------- chart

export const ChartFn = z.enum(['constant', 'log', 'linear', 'nlogn', 'quadratic', 'cubic', 'exponential'])
export type ChartFn = z.infer<typeof ChartFn>

export const ChartSeries = z
  .object({
    name: Label,
    fn: ChartFn.optional(),
    points: z.array(z.tuple([z.number(), z.number()])).optional(),
    evidence: Evidence,
  })
  .refine((s) => (s.fn === undefined) !== (s.points === undefined), {
    message: 'a series has either `fn` or `points`, never both',
  })
export type ChartSeries = z.infer<typeof ChartSeries>

/** Growth rates and numbers stated in the text; compiled to Vega-Lite (§8, §10). ≤ 4 series. */
export const ChartIR = z.object({
  type: z.literal('chart'),
  title: z.string().min(1),
  xLabel: Label,
  yLabel: Label,
  domain: z.tuple([z.number(), z.number()]),
  series: z.array(ChartSeries).min(1).max(4),
  logY: z.boolean(),
})
export type ChartIR = z.infer<typeof ChartIR>

// ---------------------------------------------------------------- math

export const MathTerm = z.object({
  symbol: z.string().min(1).max(40),
  meaning: z.string().min(1),
  evidence: Evidence,
})
export type MathTerm = z.infer<typeof MathTerm>

/** Term meanings for a formula; the formula itself always comes from the book block (§5, §10). */
export const MathIR = z.object({
  type: z.literal('math'),
  sourceBlockId: z.string().min(1),
  terms: z.array(MathTerm).min(1),
})
export type MathIR = z.infer<typeof MathIR>

// ---------------------------------------------------------------- timeline

export const TimelineLane = z.object({ id: IrId, label: Label })
export type TimelineLane = z.infer<typeof TimelineLane>

export const TimelineEvent = z.object({
  id: IrId,
  lane: IrId,
  at: z.number(),
  label: Label,
  /** Target lane of a cross-lane message. */
  to: IrId.optional(),
  evidence: Evidence,
})
export type TimelineEvent = z.infer<typeof TimelineEvent>

/** Concurrency lanes and events; always a simulated timeline (§2 D9, §10). */
export const TimelineIR = z.object({
  type: z.literal('timeline'),
  simulated: z.literal(true),
  lanes: z.array(TimelineLane).min(1),
  events: z.array(TimelineEvent),
})
export type TimelineIR = z.infer<typeof TimelineIR>

// ---------------------------------------------------------------- html

/** Last-resort self-contained HTML explainer, behind the `htmlFallback` flag only (§10, §17). */
export const HtmlIR = z.object({
  type: z.literal('html'),
  html: z.string().min(1),
  reason: z.string().min(1),
})
export type HtmlIR = z.infer<typeof HtmlIR>

// ---------------------------------------------------------------- union

/** Any extractor IR, discriminated by `type`. `trace` visuals use `Trace` instead of an IR. */
export const IR = z.discriminatedUnion('type', [
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
])
export type IR = z.infer<typeof IR>

/** IR kinds (every `VisualKind` except `trace`). */
export type IrKind = IR['type']

/** The IR type for one kind, e.g. `IrOf<'graph'>` is `GraphIR`. */
export type IrOf<K extends IrKind> = Extract<IR, { type: K }>
