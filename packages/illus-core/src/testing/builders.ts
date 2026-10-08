// Builders for whole fixtures: the small book with real content hashes, sections, plans and one IR per kind.
import { sectionContentHash } from '../ids/index.ts'
import type { Block, BookMeta, CrossRef, SectionNode } from '../schemas/book.ts'
import type { Concept, SectionIndexRecord } from '../schemas/concepts.ts'
import type { IR, IrKind, IrOf } from '../schemas/ir.ts'
import type { PlanItem, VisualPlan } from '../schemas/plan.ts'

import { make } from './factories.ts'
import {
  CHAPTER_ID,
  SECTION_COMMIT_ID,
  SECTION_LEADERS_ID,
  smallBookBlocks,
} from './small-book.ts'

export interface SmallBook {
  book: BookMeta
  sections: SectionNode[]
  blocks: Block[]
  crossRefs: CrossRef[]
  sectionIndex: SectionIndexRecord[]
  concepts: Concept[]
}

const SECTION_SHAPES: Partial<SectionNode>[] = [
  { sectionId: CHAPTER_ID, ordinal: 0, level: 1, number: '5', title: 'Log Replication', headingPath: ['5 Log Replication'] },
  {
    sectionId: SECTION_LEADERS_ID,
    ordinal: 1,
    level: 2,
    number: '5.1',
    title: 'Leaders and Followers',
    headingPath: ['5 Log Replication', '5.1 Leaders and Followers'],
    parentId: CHAPTER_ID,
  },
  {
    sectionId: SECTION_COMMIT_ID,
    ordinal: 2,
    level: 2,
    number: '5.2',
    title: 'Committing Entries',
    headingPath: ['5 Log Replication', '5.2 Committing Entries'],
    parentId: CHAPTER_ID,
  },
]

/** The small book: one chapter with two sections, real content hashes, a cross-ref, index and concepts. */
export async function buildSmallBook(): Promise<SmallBook> {
  const blocks = smallBookBlocks()
  const sections: SectionNode[] = []
  for (const shape of SECTION_SHAPES) {
    const own = blocks.filter((b) => b.sectionId === shape.sectionId)
    sections.push(
      make.sectionNode({
        ...shape,
        childIds: shape.sectionId === CHAPTER_ID ? [SECTION_LEADERS_ID, SECTION_COMMIT_ID] : [],
        blockIds: own.map((b) => b.blockId),
        contentHash: await sectionContentHash(own.map((b) => b.text)),
        tokenEstimate: Math.ceil(own.reduce((n, b) => n + b.text.length, 0) / 3.6),
        cfiStart: own[0]!.cfiRange,
        cfiEnd: own.at(-1)!.cfiRange,
      }),
    )
  }
  return {
    book: make.bookMeta({ sectionCount: sections.length }),
    sections,
    blocks,
    crossRefs: [make.crossRef()],
    sectionIndex: [make.sectionIndexRecord()],
    concepts: [make.concept()],
  }
}

/** One section of the small book (with its blocks). Default: 5.1 Leaders and Followers. */
export async function buildSection(sectionId: string = SECTION_LEADERS_ID): Promise<{ section: SectionNode; blocks: Block[] }> {
  const book = await buildSmallBook()
  const section = book.sections.find((s) => s.sectionId === sectionId)
  if (!section) throw new Error(`unknown small-book section ${sectionId}`)
  return { section, blocks: book.blocks.filter((b) => b.sectionId === sectionId) }
}

/** A plan with the given items (default: one animated graph item). */
export function buildPlan(items: Partial<PlanItem>[] = [{}]): VisualPlan {
  return make.visualPlan({
    items: items.map((o, i) => make.planItem({ planItemId: `p${i + 1}`, priority: Math.min(i + 1, 3) as 1 | 2 | 3, ...o })),
  })
}

const IR_FACTORIES: { [K in IrKind]: () => IrOf<K> } = {
  graph: () => make.graphIR(),
  sequence: () => make.sequenceIR(),
  state: () => make.stateIR(),
  class: () => make.classIR(),
  er: () => make.erIR(),
  template: () => make.templateIR(),
  chart: () => make.chartIR(),
  math: () => make.mathIR(),
  timeline: () => make.timelineIR(),
  html: () => make.htmlIR(),
}

/** A valid, grounded IR of the given kind, built over the small book. */
export function buildIR<K extends IrKind>(kind: K): IrOf<K> {
  return IR_FACTORIES[kind]() as IrOf<K>
}

/** One valid IR of every kind. */
export function buildAllIRs(): IR[] {
  return (Object.keys(IR_FACTORIES) as IrKind[]).map((k) => buildIR(k))
}

