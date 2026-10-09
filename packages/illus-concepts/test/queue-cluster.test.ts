import { make } from '@illus/core/testing'
import { describe, expect, test } from 'vitest'

import {
  acronymPairs,
  ambiguousGroups,
  canonicalName,
  clusterConcepts,
  estimateIndexUsage,
  nameKey,
  planBatches,
  prioritize,
  singular,
  takeBatch,
  toConcepts,
} from '../src/index.ts'

const sec = (ordinal: number, tokenEstimate = 100) => ({ sectionId: `s${ordinal}`, ordinal, tokenEstimate })

describe('scheduling', () => {
  test('open section first, then ±10 ordinals, then the rest, each in reading order; indexNow jumps all', () => {
    const pending = [0, 3, 6, 14, 15, 16, 25, 30, 40].map((o) => sec(o))
    expect(prioritize(pending, { ordinal: 15 }).map((s) => s.ordinal)).toEqual([15, 6, 14, 16, 25, 0, 3, 30, 40])
    expect(prioritize(pending, undefined, ['s40', 's3']).map((s) => s.ordinal)).toEqual([3, 40, 0, 6, 14, 15, 16, 25, 30])
  })

  test('batches hold at most 8 sections and 8,000 tokens; a big section goes alone', () => {
    expect(takeBatch(Array.from({ length: 12 }, (_, i) => sec(i))).length).toBe(8)
    expect(takeBatch([sec(0, 3000), sec(1, 3000), sec(2, 3000)]).map((s) => s.ordinal)).toEqual([0, 1])
    expect(takeBatch([sec(0, 9000), sec(1, 10)]).map((s) => s.ordinal)).toEqual([0])
    expect(planBatches([sec(2, 5000), sec(0, 5000), sec(1, 10)]).map((b) => b.map((s) => s.ordinal))).toEqual([[0, 1], [2]])
  })

  test('usage estimate and confirmation threshold', () => {
    const pending = [sec(0, 5000), sec(1, 5000), sec(2, 0)]
    expect(estimateIndexUsage(pending, { indexConfirmThresholdTokens: 20_000, maxRequests5h: 100 })).toEqual({
      inputTokens: 10_000 + 2 * 1500,
      requests: 2,
      windowShare: 0.02,
      needsConfirm: false,
    })
    expect(estimateIndexUsage(pending, { indexConfirmThresholdTokens: 5_000, maxRequests5h: 100 }).needsConfirm).toBe(true)
  })
})

describe('clustering', () => {
  test('keys: lowercase, punctuation, simple singular', () => {
    expect(singular('entries')).toBe('entry')
    expect(singular('classes')).toBe('class')
    expect(singular('logs')).toBe('log')
    expect(singular('consensus')).toBe('consensus')
    expect(nameKey('Log Entries!')).toBe('log entry')
    expect(nameKey('  Write-ahead   logs ')).toBe('write ahead log')
  })

  test('acronym pairs from "Long Name (LN)"', () => {
    expect(acronymPairs(['A remote procedure call (RPC) is a request.', 'not a pair (XYZ) here'])).toEqual(new Map([['rpc', 'remote procedure call']]))
  })

  const ordinals = new Map([['a', 0], ['b', 1], ['c', 2], ['d', 3]])
  const rec = (sectionId: string, defines: string[], uses: string[], quote = 'The leader accepts client requests') =>
    make.sectionIndexRecord({
      sectionId,
      defines: defines.map((name) => ({ name, evidence: make.evidence({ quote }) })),
      uses: uses.map((name) => ({ name })),
    })

  test('deterministic clusters, Concept records with firstOrdinal, definition and spanning', () => {
    const records = [
      rec('b', ['Log entry'], ['RPC']),
      rec('a', ['remote procedure call'], [], 'A remote procedure call (RPC) is a request'),
      rec('c', [], ['log entries', 'RPC']),
      rec('d', [], ['Log Entry']),
    ]
    const clusters = clusterConcepts(records, ordinals)
    expect(clusters.map((c) => c.key)).toEqual(['remote procedure call', 'log entry'])
    const concepts = toConcepts('book', clusters, ordinals)
    expect(concepts).toEqual([
      expect.objectContaining({ canonical: 'remote procedure call', aliases: ['RPC'], firstOrdinal: 0, definedInSectionId: 'a', usedInSectionIds: ['a', 'b', 'c'], spanning: true }),
      expect.objectContaining({ canonical: 'Log entry', aliases: ['Log Entry', 'log entries'], firstOrdinal: 1, usedInSectionIds: ['b', 'c', 'd'], spanning: true }),
    ])
    expect(concepts[0]!.conceptId).toBe('book:c:remote-procedure-call')
  })

  test('head-noun groups are ambiguous until a merge settles them; merges pick the canonical name', () => {
    const records = [rec('a', ['log'], []), rec('b', ['replicated log'], []), rec('c', [], ['leader'])]
    const clusters = clusterConcepts(records, ordinals)
    expect(ambiguousGroups(clusters).map((g) => g.map((c) => c.key))).toEqual([['log', 'replicated log']])
    const merged = clusterConcepts(records, ordinals, [{ canonical: 'replicated log', aliases: ['log'] }])
    expect(merged.map(canonicalName)).toEqual(['replicated log', 'leader'])
    expect(ambiguousGroups(merged)).toEqual([])
    // Existing concepts keep their ids.
    const ids = new Map([['log', 'book:c:the-log']])
    expect(toConcepts('book', merged, ordinals, ids)[0]!.conceptId).toBe('book:c:the-log')
  })
})
