import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { findQuote, ground, groundingScore, normalizeText } from '../src/index.ts'
import type { Block, GroundingContext } from '../src/index.ts'
import { make, SECTION_COMMIT_ID as C, SECTION_LEADERS_ID as L, sb, smallBookBlocks } from '../src/testing/index.ts'

const blocks = new Map(smallBookBlocks().map((b) => [b.blockId, b]))
const leaders = new Map([...blocks].filter(([, b]) => b.sectionId === L))
const ctx = (o: Partial<GroundingContext> = {}): GroundingContext => ({ blocks: leaders, ...o })
const text = (id: string) => blocks.get(id)!.text

describe('normalizeText', () => {
  it('applies NFKC, lowercase, unified quotes and dashes, drops soft hyphens, collapses whitespace', () => {
    const n = normalizeText('  The “ﬁrst” soft hy­phen — it’s  \n done ')
    expect(n.text).toBe('the "first" soft hyphen - it\'s done')
  })

  it('maps every normalised character back to its original range', () => {
    const src = 'Uses ﬂow and soft hy­phens'
    const n = normalizeText(src)
    const i = n.text.indexOf('flow')
    expect(src.slice(n.start[i]!, n.end[i + 3]!)).toBe('ﬂow')
    const j = n.text.indexOf('hyphens')
    expect(src.slice(n.start[j]!, n.end[j + 6]!)).toBe('hy­phens')
  })

  it('composes base characters with combining marks', () => {
    expect(normalizeText('café').text).toBe('café')
  })

  it('is idempotent and keeps a monotonic, in-bounds offset map (property)', () => {
    const chars = fc.constantFrom(
      ...'ab Z9.,!?\n\t ­​“”‘’—–-ﬁﬂ½é́İß…'.split(''),
    )
    fc.assert(
      fc.property(fc.array(chars, { maxLength: 60 }).map((a) => a.join('')), (s) => {
        const n = normalizeText(s)
        expect(normalizeText(n.text).text).toBe(n.text)
        expect(n.start).toHaveLength(n.text.length)
        expect(n.end).toHaveLength(n.text.length)
        for (let i = 0; i < n.text.length; i++) {
          expect(n.start[i]!).toBeLessThan(n.end[i]!)
          expect(n.end[i]!).toBeLessThanOrEqual(s.length)
          if (i > 0) expect(n.start[i]!).toBeGreaterThanOrEqual(n.start[i - 1]!)
        }
        expect(n.text).toBe(n.text.trim())
        expect(n.text).not.toMatch(/\s{2}|[­“”‘’—]/)
      }),
    )
  })

  it('the mapped-back slice of any substring normalises to text containing it (property)', () => {
    const words = fc.constantFrom('The', 'leader', '“sends”', 'ﬁles', 'hy­phen', '—', 'it’s', 'Log.')
    const seps = fc.constantFrom(' ', '  ', '\n', ' ')
    fc.assert(
      fc.property(
        fc.array(fc.tuple(words, seps), { minLength: 1, maxLength: 12 }),
        fc.nat(),
        fc.nat(),
        (parts, a, b) => {
          const s = parts.map(([w, sep]) => w + sep).join('')
          const n = normalizeText(s)
          if (!n.text) return
          const from = a % n.text.length
          const to = from + 1 + (b % (n.text.length - from))
          const sub = n.text.slice(from, to).trim()
          if (!sub) return
          const orig = s.slice(n.start[from]!, n.end[to - 1]!)
          // A slice can split an expanded cluster (ﬁ → fi), so the original range may cover slightly more.
          expect(normalizeText(orig).text).toContain(sub)
        },
      ),
    )
  })
})

describe('ground', () => {
  it('passes an exact quote in the cited block and fills start/end in the original text', () => {
    const r = ground(make.evidence(), ctx({ label: 'Leader' }))
    expect(r.status).toBe('grounded')
    expect(r.evidence!.blockId).toBe(sb(L, 0))
    expect(text(sb(L, 0)).slice(r.evidence!.start, r.evidence!.end)).toBe('The leader accepts client requests')
    expect(r.evidence!.fuzzy).toBeUndefined()
  })

  it('matches across typography differences (smart quotes, case, whitespace)', () => {
    const block: Block = { ...blocks.get(sb(L, 0))!, text: 'The “leader” accepts\nclient requests.' }
    const r = ground({ blockId: block.blockId, quote: 'the "leader"   accepts client' }, { blocks: new Map([[block.blockId, block]]) })
    expect(r.status).toBe('grounded')
    expect(block.text.slice(r.evidence!.start, r.evidence!.end)).toBe('The “leader” accepts\nclient')
  })

  it('re-attributes a quote found in another permitted block', () => {
    const r = ground({ blockId: sb(L, 0), quote: 'sends AppendEntries messages to every follower' }, ctx({ label: 'AppendEntries' }))
    expect(r.status).toBe('grounded')
    expect(r.evidence!.blockId).toBe(sb(L, 1))
    expect(r.reason).toMatch(/re-attributed/)
  })

  it('never looks outside the permitted blocks', () => {
    const r = ground({ blockId: sb(C, 0), quote: 'An entry is committed once the leader' }, ctx())
    expect(r.status).toBe('failed')
  })

  it('accepts a fuzzy match at similarity ≥ 0.9 and marks it', () => {
    const r = ground({ blockId: sb(L, 1), quote: 'sends AppendEntry messages to every follower in parallel' }, ctx({ label: 'AppendEntries' }))
    expect(r.status).toBe('grounded')
    expect(r.evidence!.fuzzy).toBe(true)
    // Windows are whitespace-delimited words, so trailing punctuation comes along.
    expect(text(sb(L, 1)).slice(r.evidence!.start, r.evidence!.end)).toBe('sends AppendEntries messages to every follower in parallel.')
  })

  it('fails a paraphrase below the fuzzy threshold', () => {
    const r = ground({ blockId: sb(L, 1), quote: 'the leader broadcasts entries to all followers at once' }, ctx())
    expect(r).toEqual({ status: 'failed', reason: 'quote not found in any permitted block' })
  })

  it('fails quotes shorter than 3 words even when they match', () => {
    expect(ground({ blockId: sb(L, 0), quote: 'The leader' }, ctx()).status).toBe('failed')
    expect(ground({ blockId: sb(L, 0), quote: 'The leader accepts' }, ctx()).status).toBe('grounded')
  })

  describe('relevance (§16 step 7)', () => {
    const stateBlock = sb(L, 3)
    const q = { blockId: stateBlock, quote: 'starts an election' }

    it('is grounded when a label word is in the quote’s sentence or a neighbouring one', () => {
      expect(ground(q, ctx({ label: 'Candidate' })).status).toBe('grounded')
      // "three states" is in the previous sentence
      expect(ground(q, ctx({ label: 'Three states' })).status).toBe('grounded')
    })

    it('is half-grounded when no label word is near the quote', () => {
      const r = ground({ blockId: sb(L, 0), quote: 'appends each command to its log' }, ctx({ label: 'Election timer' }))
      expect(r.status).toBe('half-grounded')
      expect(r.evidence).toBeDefined()
      expect(r.reason).toMatch(/label/)
    })

    it('uses glossary aliases and ignores stopwords and plurals', () => {
      const e = { blockId: sb(L, 0), quote: 'appends each command to its log' }
      expect(ground(e, ctx({ label: 'The primary', aliases: ['leader'] })).status).toBe('grounded')
      expect(ground(e, ctx({ label: 'of the to' })).status).toBe('grounded')
      expect(ground({ blockId: sb(L, 2), quote: 'appends the entries to its own log' }, ctx({ label: 'Entry' })).status).toBe('grounded')
    })

    it('treats sentences of code blocks as lines', () => {
      const codeCtx = { blocks: new Map([[sb(C, 1), blocks.get(sb(C, 1))!]]) }
      const e = { blockId: sb(C, 1), quote: 'l.commitIndex = majority' }
      expect(ground(e, { ...codeCtx, label: 'commitIndex' }).status).toBe('grounded')
      expect(ground(e, { ...codeCtx, label: 'sort' }).status).toBe('half-grounded')
    })
  })

  it('scores (grounded + 0.5 × half) / total', () => {
    expect(groundingScore({ total: 4, grounded: 2, halfGrounded: 2 })).toBe(0.75)
    expect(groundingScore({ total: 0, grounded: 0, halfGrounded: 0 })).toBe(0)
  })
})

describe('findQuote', () => {
  it('returns original offsets for exact and fuzzy matches, or null', () => {
    const t = 'A ﬁle is “saved” to disk.'
    const m = findQuote(t, 'a file is "saved"')!
    expect(t.slice(m.start, m.end)).toBe('A ﬁle is “saved”')
    expect(m.fuzzy).toBe(false)
    expect(findQuote(t, 'nothing like this at all')).toBeNull()
  })
})
