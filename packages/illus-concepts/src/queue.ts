// Concept-pass scheduling (§6 phase B steps 1–3, 8): priority order, batching, usage estimate.
import type { SectionNode } from '@illus/core'

export const MAX_BATCH_SECTIONS = 8
export const MAX_BATCH_TOKENS = 8000
/** Ordinals within this distance of the open section come right after it (§6 phase B step 1). */
export const NEAR_ORDINALS = 10
/** Estimated tokens per indexer call besides the section text: system prompt, book prefix, tags. */
export const BATCH_OVERHEAD_TOKENS = 1500

type Sec = Pick<SectionNode, 'sectionId' | 'ordinal' | 'tokenEstimate'>

/**
 * Pending sections in indexing order: `urgent` (`indexNow`, latest request first), then the open
 * section, then ordinals within ±10 of it, then the rest; reading order inside each group.
 */
export function prioritize<S extends Sec>(pending: readonly S[], open?: { ordinal: number }, urgent: readonly string[] = []): S[] {
  const rank = (s: S) => {
    const u = urgent.indexOf(s.sectionId)
    if (u >= 0) return -2 - u
    if (!open) return 0
    if (s.ordinal === open.ordinal) return -1
    return Math.abs(s.ordinal - open.ordinal) <= NEAR_ORDINALS ? 0 : 1
  }
  return [...pending].sort((a, b) => rank(a) - rank(b) || a.ordinal - b.ordinal)
}

/** The next batch: the first section, then following ones while ≤ 8 sections and ≤ 8,000 tokens. */
export function takeBatch<S extends Sec>(ordered: readonly S[]): S[] {
  const batch: S[] = []
  let tokens = 0
  for (const s of ordered) {
    if (batch.length === MAX_BATCH_SECTIONS) break
    if (batch.length && tokens + s.tokenEstimate > MAX_BATCH_TOKENS) break
    batch.push(s)
    tokens += s.tokenEstimate
  }
  return batch
}

/** Every batch of a full pass in reading order. */
export function planBatches<S extends Sec>(sections: readonly S[]): S[][] {
  const rest = [...sections].sort((a, b) => a.ordinal - b.ordinal)
  const out: S[][] = []
  while (rest.length) out.push(rest.splice(0, takeBatch(rest).length))
  return out
}

export interface IndexUsageEstimate {
  /** Estimated input tokens of all indexer calls. */
  inputTokens: number
  /** Indexer calls (glossary and summary calls add a handful more). */
  requests: number
  /** Share of the local five-hour request cap the pass would use (§6 phase B step 8). */
  windowShare: number
  /** Above `indexConfirmThresholdTokens`: ask the reader before starting. */
  needsConfirm: boolean
}

/** Pre-index usage estimate for sections that still need an index (§6 phase B step 8). */
export function estimateIndexUsage(
  pending: readonly Sec[],
  opts: { indexConfirmThresholdTokens: number; maxRequests5h: number },
): IndexUsageEstimate {
  const withText = pending.filter((s) => s.tokenEstimate > 0)
  const requests = planBatches(withText).length
  const inputTokens = withText.reduce((n, s) => n + s.tokenEstimate, 0) + requests * BATCH_OVERHEAD_TOKENS
  return {
    inputTokens,
    requests,
    windowShare: opts.maxRequests5h > 0 ? requests / opts.maxRequests5h : 1,
    needsConfirm: inputTokens > opts.indexConfirmThresholdTokens,
  }
}
