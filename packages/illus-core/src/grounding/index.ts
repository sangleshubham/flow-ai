// Grounding matcher: ground() (§16 "Grounding matcher", steps 1–7). Owner: W10. Pure and synchronous.
import { distance } from 'fastest-levenshtein'

import type { Evidence } from '../schemas/common.ts'
import type { GroundingContext, GroundingFn, GroundingResult } from '../schemas/ports.ts'
import type { ValidationReport } from '../schemas/quality.ts'

import { contentTerms, normalizeText, originalRange, words } from './normalize.ts'
import type { Normalized } from './normalize.ts'

export { normalizeText, originalRange } from './normalize.ts'
export type { Normalized } from './normalize.ts'

/** Minimum normalised Levenshtein similarity for a fuzzy match (§16 step 4). */
export const FUZZY_THRESHOLD = 0.9
/** Quotes shorter than this many words fail (§16 step 6). */
export const MIN_QUOTE_WORDS = 3

export interface QuoteMatch {
  /** Offsets into the original (un-normalised) text. */
  start: number
  end: number
  fuzzy: boolean
  /** 1 for exact matches, else the Levenshtein similarity. */
  similarity: number
}

/** Best sliding window of `n-1 … n+1` words with similarity ≥ the threshold (§16 step 4). */
function fuzzyIn(quote: string, norm: Normalized): { from: number; to: number; sim: number } | null {
  const text = norm.text
  const n = words(quote).length
  const starts: number[] = []
  for (let i = 0; i < text.length; i++) if (i === 0 || text[i - 1] === ' ') starts.push(i)
  const endOf = (w: number) => (w + 1 < starts.length ? starts[w + 1]! - 1 : text.length)
  let best: { from: number; to: number; sim: number } | null = null
  for (let k = Math.max(1, n - 1); k <= n + 1; k++) {
    for (let w = 0; w + k <= starts.length; w++) {
      const from = starts[w]!
      const to = endOf(w + k - 1)
      const len = Math.max(to - from, quote.length)
      // The edit distance is at least the length difference, which rules out most windows cheaply.
      if (1 - Math.abs(to - from - quote.length) / len < FUZZY_THRESHOLD) continue
      const sim = 1 - distance(quote, text.slice(from, to)) / len
      if (sim >= FUZZY_THRESHOLD && (!best || sim > best.sim)) best = { from, to, sim }
    }
  }
  return best
}

function exactIn(quote: string, norm: Normalized): QuoteMatch | null {
  const i = quote ? norm.text.indexOf(quote) : -1
  return i < 0 ? null : { ...originalRange(norm, i, i + quote.length), fuzzy: false, similarity: 1 }
}

function fuzzyMatch(quote: string, norm: Normalized): QuoteMatch | null {
  const f = quote ? fuzzyIn(quote, norm) : null
  return f ? { ...originalRange(norm, f.from, f.to), fuzzy: true, similarity: f.sim } : null
}

/**
 * Finds a quote in one text after normalising both (§16 steps 1, 2, 4): the first exact occurrence, else
 * the best fuzzy window. Offsets refer to the original `text`. Used by `ground()` and by the reader
 * bridge's `quoteToCfi` (W9).
 */
export function findQuote(text: string, quote: string): QuoteMatch | null {
  const q = normalizeText(quote).text
  const norm = normalizeText(text)
  return exactIn(q, norm) ?? fuzzyMatch(q, norm)
}

/** Original-text ranges of a block's sentences (split after . ! ? before whitespace, and at newlines). */
function sentences(text: string): [number, number][] {
  const out: [number, number][] = []
  let s = 0
  for (const m of text.matchAll(/[.!?]+(?=\s|$)|\n/g)) {
    const e = m.index + m[0].length
    if (text.slice(s, e).trim()) out.push([s, e])
    s = e
  }
  if (text.slice(s).trim()) out.push([s, text.length])
  return out
}

/**
 * §16 step 7: a non-stopword of the label (or of a glossary alias) appears in the quote's sentence or the
 * sentence on either side. A label with no content words has nothing to check and passes.
 */
function relevant(text: string, start: number, end: number, ctx: GroundingContext): boolean {
  const terms = new Set<string>()
  for (const s of [ctx.label ?? '', ...(ctx.aliases ?? [])]) for (const t of contentTerms(s)) terms.add(t)
  if (terms.size === 0) return true
  const sents = sentences(text)
  const first = Math.max(0, sents.findIndex(([, e]) => e > start) - 1)
  const last = Math.min(sents.length - 1, sents.findLastIndex(([s]) => s < end) + 1)
  if (last < first) return false
  const near = contentTerms(text.slice(sents[first]![0], sents[last]![1]))
  for (const t of terms) if (near.has(t)) return true
  return false
}

/** Exact in the cited block, else exact in another permitted block, else the best fuzzy window anywhere. */
function locate(evidence: Evidence, quote: string, ctx: GroundingContext): (QuoteMatch & { blockId: string }) | null {
  const ids = [evidence.blockId, ...[...ctx.blocks.keys()].filter((id) => id !== evidence.blockId)]
  const norms = ids.flatMap((id) => {
    const b = ctx.blocks.get(id)
    return b ? [[id, normalizeText(b.text)] as const] : []
  })
  for (const [blockId, norm] of norms) {
    const m = exactIn(quote, norm)
    if (m) return { ...m, blockId }
  }
  let best: (QuoteMatch & { blockId: string }) | null = null
  for (const [blockId, norm] of norms) {
    const m = fuzzyMatch(quote, norm)
    if (m && (!best || m.similarity > best.similarity)) best = { ...m, blockId }
  }
  return best
}

/**
 * The grounding matcher (§16). Locates an evidence quote in the permitted blocks: exact in the cited block,
 * else exact in another permitted block (re-attributed), else fuzzy (similarity ≥ 0.9). Fills `start`/`end`
 * (offsets into the block's `text`) and `fuzzy`. A match whose label is not near the quote is
 * `half-grounded`; a quote under 3 words or not found is `failed`.
 */
export const ground: GroundingFn = (evidence, ctx): GroundingResult => {
  const quote = normalizeText(evidence.quote).text
  if (words(quote).length < MIN_QUOTE_WORDS)
    return { status: 'failed', reason: `quote shorter than ${MIN_QUOTE_WORDS} words` }
  const m = locate(evidence, quote, ctx)
  if (!m) return { status: 'failed', reason: 'quote not found in any permitted block' }

  const grounded: Evidence = { blockId: m.blockId, quote: evidence.quote, start: m.start, end: m.end }
  if (m.fuzzy) grounded.fuzzy = true
  const notes = m.blockId !== evidence.blockId ? [`re-attributed from ${evidence.blockId}`] : []
  const ok = relevant(ctx.blocks.get(m.blockId)!.text, m.start, m.end, ctx)
  if (!ok) notes.push('label not found near the quote')
  const result: GroundingResult = { status: ok ? 'grounded' : 'half-grounded', evidence: grounded }
  if (notes.length) result.reason = notes.join('; ')
  return result
}

/** (grounded + 0.5 × half-grounded) / total, or 0 when there is nothing to ground (§16). */
export function groundingScore(counts: Pick<ValidationReport['counts'], 'total' | 'grounded' | 'halfGrounded'>): number {
  return counts.total === 0 ? 0 : (counts.grounded + 0.5 * counts.halfGrounded) / counts.total
}
