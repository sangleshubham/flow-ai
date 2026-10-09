// MiniSearch index over block text for the lexical fallback of §7 ("limited to earlier ordinals").
import type { Block, SectionNode } from '@illus/core'
import MiniSearch from 'minisearch'

import { foldForMatch } from './text.ts'

export interface LexicalHit {
  blockId: string
  sectionId: string
  /** Ordinal of the block's section. */
  ordinal: number
  score: number
}

export interface LexicalSearchOptions {
  /** Only blocks of sections with `ordinal < beforeOrdinal` are returned (reading-position gating, §7). */
  beforeOrdinal: number
  /** Default 3 (the `lexicalFallback` slot's top 3). */
  limit?: number
}

export interface LexicalIndex {
  search(query: string, opts: LexicalSearchOptions): LexicalHit[]
}

interface Doc {
  blockId: string
  sectionId: string
  ordinal: number
  text: string
}

/** Builds the index over every block; text is indexed in its NFKC-folded match form. */
export function buildLexicalIndex(
  blocks: readonly Block[],
  sections: readonly Pick<SectionNode, 'sectionId' | 'ordinal'>[],
): LexicalIndex {
  const ordinals = new Map(sections.map((s) => [s.sectionId, s.ordinal]))
  const index = new MiniSearch<Doc>({ idField: 'blockId', fields: ['text'], storeFields: ['sectionId', 'ordinal'] })
  index.addAll(
    blocks.flatMap((b) => {
      const ordinal = ordinals.get(b.sectionId)
      return ordinal === undefined ? [] : [{ blockId: b.blockId, sectionId: b.sectionId, ordinal, text: foldForMatch(b.text) }]
    }),
  )
  return {
    search(query, { beforeOrdinal, limit = 3 }) {
      return index
        .search(foldForMatch(query), { filter: (r) => (r.ordinal as number) < beforeOrdinal })
        .slice(0, limit)
        .map((r) => ({ blockId: r.id as string, sectionId: r.sectionId as string, ordinal: r.ordinal as number, score: r.score }))
    },
  }
}
