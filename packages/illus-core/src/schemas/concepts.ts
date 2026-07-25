import { z } from 'zod'

import { Evidence, maxWords, ProducedWith } from './common.ts'

/** Content flags the indexer sets per section (§5). */
export const SectionFlags = z.object({
  algorithm: z.boolean(),
  protocol: z.boolean(),
  architecture: z.boolean(),
  dataStructure: z.boolean(),
  stateMachine: z.boolean(),
  math: z.boolean(),
  codeHeavy: z.boolean(),
  narrative: z.boolean(),
})
export type SectionFlags = z.infer<typeof SectionFlags>

/** What the `indexer` model returns for one section; the client adds `indexedWith`. */
export const SectionIndexOutput = z.object({
  sectionId: z.string().min(1),
  summary: maxWords(60),
  defines: z.array(z.object({ name: z.string().min(1), evidence: Evidence })),
  uses: z.array(z.object({ name: z.string().min(1) })),
  flags: SectionFlags,
})
export type SectionIndexOutput = z.infer<typeof SectionIndexOutput>

/** Per-section concept index (§5). */
export const SectionIndex = SectionIndexOutput.extend({
  indexedWith: ProducedWith,
})
export type SectionIndex = z.infer<typeof SectionIndex>

/** Record of the `sectionIndex` store: a `SectionIndex` plus its `bookId` (store index, §5). */
export const SectionIndexRecord = SectionIndex.extend({
  bookId: z.string().min(1),
})
export type SectionIndexRecord = z.infer<typeof SectionIndexRecord>

/**
 * Output of the `indexer` role: one entry per section in the batch (≤ 8 sections, §6 phase B step 3).
 * Wrapped in an object because structured outputs need an object at the root (ADR 0003).
 */
export const IndexerOutput = z.object({
  sections: z.array(SectionIndexOutput).min(1).max(8),
})
export type IndexerOutput = z.infer<typeof IndexerOutput>

/** A concept in the book-wide registry (§5). */
export const Concept = z.object({
  conceptId: z.string().min(1),
  bookId: z.string().min(1),
  canonical: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  definedInSectionId: z.string().min(1).optional(),
  definition: Evidence.optional(),
  firstOrdinal: z.number().int().nonnegative(),
  usedInSectionIds: z.array(z.string().min(1)),
  /** Used in ≥ 3 sections → eligible for a concept model. */
  spanning: z.boolean(),
})
export type Concept = z.infer<typeof Concept>

/** One merged cluster from the `glossary` role: a canonical name and its aliases (§6 phase B step 5). */
export const ConceptMerge = z.object({
  canonical: z.string().min(1),
  aliases: z.array(z.string().min(1)),
})
export type ConceptMerge = z.infer<typeof ConceptMerge>

/** Output of the `glossary` role (`ConceptMerge[]` wrapped in an object, ADR 0003). */
export const GlossaryOutput = z.object({
  merges: z.array(ConceptMerge),
})
export type GlossaryOutput = z.infer<typeof GlossaryOutput>
