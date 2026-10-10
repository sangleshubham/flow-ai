// §16 L6: turns reader feedback into regression cases. The reader's "Export cache" file (W2's
// `illus-cache` format) carries each visual's thumbs vote and element reports; every thumbs-down or
// "This is wrong" report becomes one EvalCase for Shubham to review.
import { sha256Hex, VisualRecord } from '@illus/core'
import type { VisualKind } from '@illus/core'
import { SMALL_BOOK_ID } from '@illus/core/testing'
import { z } from 'zod'

import { EVAL_MINI_BOOK_ID } from './books/eval-mini.ts'
import { EvalCase } from './case.ts'
import type { EvalCategory } from './case.ts'

/** bookId of fixtures/books/synthetic.epub. */
export const SYNTHETIC_BOOK_ID = '9604b90977df58f0'

/** The part of W2's cache file the export reads (other stores are ignored). */
const FeedbackFile = z.object({
  format: z.literal('illus-cache'),
  bookId: z.string(),
  stores: z.object({
    books: z.array(z.object({ title: z.string() }).loose()),
    sections: z.array(z.object({ sectionId: z.string(), title: z.string() }).loose()),
    visuals: z.array(VisualRecord),
  }).loose(),
}).loose()

const CATEGORY: Record<VisualKind, EvalCategory> = {
  graph: 'architecture',
  class: 'architecture',
  er: 'architecture',
  html: 'architecture',
  sequence: 'protocol',
  timeline: 'protocol',
  state: 'state',
  template: 'data-structure',
  trace: 'algorithmic',
  chart: 'algorithmic',
  math: 'math',
}

/** The label of the IR element with this id (or the template path), if any. */
function labelOf(ir: unknown, elementId: string): string | undefined {
  let found: string | undefined
  const walk = (v: unknown): void => {
    if (found || !v || typeof v !== 'object') return
    if (Array.isArray(v)) return v.forEach(walk)
    const o = v as Record<string, unknown>
    if (o.id === elementId && typeof o.label === 'string') found = o.label
    else Object.values(o).forEach(walk)
  }
  walk(ir)
  return found
}

export interface FeedbackCase {
  case: EvalCase
  /** True for books outside the repository: the case goes to `regressions/private/` (git-ignored). */
  private: boolean
}

/**
 * Regression cases from one cache file. Expected: a visual is needed, of the kind that was planned (the
 * reader judged that visual), and the labels of elements reported wrong must not come back
 * (`mustNotInclude`). Notes carry the reader's words for review (ADR 0043).
 */
export async function feedbackCases(file: unknown, opts: { bookRef?: string } = {}): Promise<FeedbackCase[]> {
  const cache = FeedbackFile.parse(file)
  const known: Record<string, string> = { [SYNTHETIC_BOOK_ID]: 'synthetic', [EVAL_MINI_BOOK_ID]: 'eval-mini', [SMALL_BOOK_ID]: 'small-book' }
  const bookRef = opts.bookRef ?? known[cache.bookId] ?? `private:${cache.stores.books[0]?.title || cache.bookId}`
  const titles = new Map(cache.stores.sections.map((s) => [s.sectionId, s.title.trim()]))
  const out: FeedbackCase[] = []
  for (const v of cache.stores.visuals) {
    const reports = v.elementReports ?? []
    if (v.feedback?.vote !== 'down' && !reports.length) continue
    const wrong = [...new Set(reports.flatMap((r) => labelOf(v.ir, r.elementId) ?? []))]
    const notes = [
      v.feedback?.vote === 'down' && `Thumbs down${v.feedback.note ? `: ${v.feedback.note}` : ''}.`,
      ...reports.map((r) => `Wrong ${r.elementId}${labelOf(v.ir, r.elementId) ? ` (${labelOf(v.ir, r.elementId)})` : ''}: ${r.note}`),
      `Exported from visual ${v.cacheKey.slice(0, 12)} (${v.kind}, plan item ${v.planItemId}). Review before relying on it.`,
    ].filter(Boolean)
    out.push({
      private: bookRef.startsWith('private:'),
      case: EvalCase.parse({
        id: `fb-${(await sha256Hex(v.cacheKey)).slice(0, 12)}`,
        category: CATEGORY[v.kind],
        bookRef,
        sectionId: v.sectionId,
        title: titles.get(v.sectionId) ?? v.sectionId,
        expected: { needsVisual: true, acceptableKinds: [v.kind], mustInclude: [], mustNotInclude: wrong },
        source: 'regression',
        notes: notes.join(' '),
      }),
    })
  }
  return out
}
