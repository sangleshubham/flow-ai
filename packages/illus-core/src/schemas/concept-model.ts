// Progressive concept diagrams (§13): a persistent model stored as a base patch plus ordered patches.
import { z } from 'zod'

import { Evidence, IrId, Label, ProducedWith } from './common.ts'
import { GraphEdge, GraphGroup, GraphNode, SequenceMessage, SequenceParticipant, StateNode, StateTransition } from './ir.ts'
import { ConceptModelKind } from './plan.ts'

/** One patch operation (§13). The spec's `item: unknown` add-ops are typed per kind here. */
export const PatchOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('addNode'), node: GraphNode }),
  z.object({ op: z.literal('addEdge'), edge: GraphEdge }),
  z.object({ op: z.literal('addGroup'), group: GraphGroup }),
  z.object({ op: z.literal('addParticipant'), item: SequenceParticipant }),
  z.object({ op: z.literal('addMessage'), item: SequenceMessage }),
  z.object({ op: z.literal('addState'), item: StateNode }),
  z.object({ op: z.literal('addTransition'), item: StateTransition }),
  z.object({
    op: z.literal('update'),
    id: IrId,
    label: Label.optional(),
    sublabel: Label.optional(),
    group: IrId.optional(),
    evidence: Evidence,
  }),
  /** Only when the text says the element was replaced or removed. */
  z.object({ op: z.literal('remove'), id: IrId, evidence: Evidence }),
  z.object({ op: z.literal('annotate'), id: IrId, text: z.string().min(1).max(40), evidence: Evidence }),
])
export type PatchOp = z.infer<typeof PatchOp>

/** Output of the `patcher` role: at most 8 ops for one section (§13). */
export const PatchOutput = z.object({
  ops: z.array(PatchOp).min(1).max(8),
})
export type PatchOutput = z.infer<typeof PatchOutput>

/** A stored patch (§5). Patch 0 of a model is its base. */
export const Patch = z.object({
  patchId: z.string().min(1),
  sectionId: z.string().min(1),
  sectionOrdinal: z.number().int().nonnegative(),
  ops: z.array(PatchOp).max(8),
  createdWith: ProducedWith,
  /** Generated from the state plus gap-section summaries when more than 3 sections were skipped (§13 step 4). */
  rebased: z.boolean().optional(),
  /** Failed re-validation after an out-of-order insert; regenerated on the next visit (§13 step 5). */
  stale: z.boolean().optional(),
})
export type Patch = z.infer<typeof Patch>

/** Record of the `conceptModels` store (§5). Patches are sorted by `sectionOrdinal`. */
export const ConceptModel = z
  .object({
    conceptModelId: z.string().min(1),
    conceptId: z.string().min(1),
    bookId: z.string().min(1),
    kind: ConceptModelKind,
    patches: z.array(Patch),
    /** Node positions after the last render, used as ELK interactive hints (§13). */
    layout: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).optional(),
  })
  .refine((m) => m.patches.every((p, i, a) => i === 0 || a[i - 1]!.sectionOrdinal <= p.sectionOrdinal), {
    message: 'patches must be sorted by sectionOrdinal',
    path: ['patches'],
  })
export type ConceptModel = z.infer<typeof ConceptModel>
