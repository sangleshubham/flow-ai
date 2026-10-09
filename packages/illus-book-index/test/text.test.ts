import { describe, expect, test } from 'vitest'

import {
  estimateTokens,
  findTextualRefs,
  foldForMatch,
  normalizeText,
  parseCaptionLabel,
  parseHeadingNumber,
} from '../src/index.ts'

describe('normalisation (§6 step 9)', () => {
  test('NFC, soft hyphens removed, whitespace collapsed', () => {
    expect(normalizeText('  soft hy­phen\n\t café  ')).toBe('soft hyphen café')
  })
  test('ligatures and smart quotes stay in the text, but fold in the match copy', () => {
    const text = normalizeText('the ﬁrst “basic” ‘flow’ — done')
    expect(text).toBe('the ﬁrst “basic” ‘flow’ — done')
    expect(foldForMatch(text)).toBe('the first "basic" \'flow\' - done')
  })
})

test('token estimates: chars/3.6 for prose, chars/3 for code (§6 step 10)', () => {
  expect(estimateTokens('x'.repeat(36), false)).toBe(10)
  expect(estimateTokens('x'.repeat(37), false)).toBe(11)
  expect(estimateTokens('x'.repeat(30), true)).toBe(10)
})

test.each([
  ['Chapter 5 Consensus', '5'],
  ['5.3.2 Log Matching', '5.3.2'],
  ['12 Things', '12'],
  ['Introduction', undefined],
  ['5.3', undefined], // needs trailing whitespace and a title
  ['Version 2 Notes', undefined],
])('heading number of %j (§6 step 5)', (title, number) => {
  expect(parseHeadingNumber(title)).toBe(number)
})

test.each([
  ['Listing 4.2 Binary search', 'Listing 4.2', 'Listing 4.2'],
  ['Fig. 3.1 A cluster', 'Fig. 3.1', 'Figure 3.1'],
  ['Figure A.1 Appendix figure', undefined, undefined],
  ['Table B2 Opcodes', 'Table B2', 'Table B2'],
  ['Example 7 Hello', 'Example 7', 'Example 7'],
  ['See Listing 4.2', undefined, undefined], // anchored at the start
])('caption label of %j (§6 step 7)', (caption, label, key) => {
  const parsed = parseCaptionLabel(caption)
  expect(parsed?.label).toBe(label)
  expect(parsed?.key).toBe(key)
})

test('textual references (§6 step 13)', () => {
  const refs = findTextualRefs('See Fig. 2.1 and Listing 1.1, Section 3.2, Chapter 4, Appendix 1 and Table A3.')
  expect(refs.map((r) => [r.label, r.key, r.by])).toEqual([
    ['Fig. 2.1', 'Figure 2.1', 'label'],
    ['Listing 1.1', 'Listing 1.1', 'label'],
    ['Section 3.2', 'Section 3.2', 'number'],
    ['Chapter 4', 'Chapter 4', 'number'],
    ['Appendix 1', 'Appendix 1', 'number'],
    ['Table A3', 'Table A3', 'label'],
  ])
  expect(findTextualRefs('Figures 2 and tables')).toEqual([])
})
