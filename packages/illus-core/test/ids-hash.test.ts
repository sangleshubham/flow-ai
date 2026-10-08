import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { nodeSha256Hex } from '../src/hash/index.ts'
import {
  headingSlugPath,
  makeBlockId,
  makeBookId,
  makeConceptId,
  makeSectionId,
  parseBlockId,
  parseSectionId,
  sectionContentHash,
  sha256Hex,
  slugify,
} from '../src/index.ts'

const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

describe('hash', () => {
  it('matches the SHA-256 test vector via Web Crypto and via the node fallback', async () => {
    expect(await sha256Hex('abc')).toBe(ABC)
    expect(await nodeSha256Hex('abc')).toBe(ABC)
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(ABC)
  })

  it('agrees between implementations on arbitrary input', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 256 }), async (bytes) => {
        expect(await sha256Hex(bytes)).toBe(await nodeSha256Hex(bytes))
      }),
      { numRuns: 50 },
    )
  })
})

describe('ids', () => {
  it('slugifies headings deterministically and never returns an empty slug', () => {
    expect(slugify('5.3 Log Replication')).toBe('5-3-log-replication')
    expect(slugify('Café — naïve “quotes”')).toBe('cafe-naive-quotes')
    expect(slugify('***')).toBe('_')
    expect(slugify('x'.repeat(100))).toHaveLength(48)
    expect(headingSlugPath(['Ch 5', '5.3 Log'])).toBe('ch-5/5-3-log')
    expect(headingSlugPath([])).toBe('_')
  })

  it('builds bookId from the first 16 hex chars of the EPUB hash', async () => {
    expect(await makeBookId(new TextEncoder().encode('abc'))).toBe(ABC.slice(0, 16))
  })

  it('round-trips section ids and block ids for any heading path', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { maxLength: 4 }),
        fc.nat(500),
        fc.nat(50),
        fc.nat(200),
        (headingPath, spineIndex, ordinalInSpine, n) => {
          const bookId = '0123456789abcdef'
          const sectionId = makeSectionId({ bookId, spineIndex, headingPath, ordinalInSpine })
          expect(parseSectionId(sectionId)).toEqual({
            bookId,
            spineIndex,
            headingSlugPath: headingSlugPath(headingPath),
            ordinalInSpine,
          })
          expect(parseBlockId(makeBlockId(sectionId, n))).toEqual({ sectionId, n })
        },
      ),
    )
  })

  it('formats ids exactly as §5', () => {
    const sectionId = makeSectionId({ bookId: '0123456789abcdef', spineIndex: 4, headingPath: ['Raft', 'Log Replication'], ordinalInSpine: 2 })
    expect(sectionId).toBe('0123456789abcdef:4:raft/log-replication:2')
    expect(makeBlockId(sectionId, 3)).toBe('0123456789abcdef:4:raft/log-replication:2#b3')
    expect(parseSectionId('nope')).toBeNull()
    expect(makeConceptId('0123456789abcdef', 'Log Entry')).toBe('0123456789abcdef:c:log-entry')
  })

  it('hashes section content from block texts joined by newlines', async () => {
    expect(await sectionContentHash(['a', 'b'])).toBe(await sha256Hex('a\nb'))
    expect(await sectionContentHash(['a', 'b'])).not.toBe(await sectionContentHash(['a b']))
  })
})
