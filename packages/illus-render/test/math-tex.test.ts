import katex from 'katex'
import { describe, expect, it } from 'vitest'

import { markTexTerms } from '../src/math/tex.ts'

const render = (tex: string) =>
  katex.renderToString(tex, { throwOnError: true, trust: (c) => c.command === '\\htmlClass', strict: 'ignore' })

describe('markTexTerms', () => {
  it('wraps each occurrence of a symbol', () => {
    expect(markTexTerms('n + n^2', ['n'])).toBe('{\\htmlClass{illus-term-0}{n}} + {\\htmlClass{illus-term-0}{n}}^2')
  })

  it('prefers longer symbols and keeps them whole', () => {
    const out = markTexTerms('T(n) = 2T(n/2) + n', ['n', 'T(n)'])
    expect(out.startsWith('{\\htmlClass{illus-term-1}{T(n)}}')).toBe(true)
    expect(out.endsWith('+ {\\htmlClass{illus-term-0}{n}}')).toBe(true)
  })

  it('never touches command or environment names', () => {
    const out = markTexTerms('\\begin{array}{c} a \\end{array} \\frac{a}{b}', ['a', 'r'])
    expect(out).toContain('\\begin{array}')
    expect(out).toContain('\\end{array}')
    expect(out).toContain('\\frac{{\\htmlClass{illus-term-0}{a}}}{b}')
  })

  it('wraps command symbols such as \\alpha', () => {
    expect(markTexTerms('\\alpha x', ['\\alpha'])).toBe('{\\htmlClass{illus-term-0}{\\alpha}} x')
  })

  it('keeps the formula valid for KaTeX, including superscripts and subscripts', () => {
    for (const [tex, syms] of [
      ['2^n + x_i', ['n', 'i', 'x']],
      ['\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', ['i', 'n']],
      ['\\left( n \\right)', ['n']],
      ['\\lceil \\log_2 n \\rceil', ['n']],
      ['\\hat n + \\sqrt n', ['n']],
    ] as const) {
      const marked = markTexTerms(tex, syms)
      expect(() => render(marked)).not.toThrow()
      expect(render(marked)).toContain('illus-term-')
    }
  })

  it('leaves the formula unchanged when nothing matches', () => {
    expect(markTexTerms('a + b', ['z'])).toBe('a + b')
  })
})
