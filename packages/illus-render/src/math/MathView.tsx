// Math renderer (§10): the formula comes from the book block. MathML renders natively; TeX goes through
// KaTeX with `trust` limited to `\htmlClass`. Terms sit in a table beside the formula; hovering a term
// highlights its symbol (and, through the surface, its evidence).
import katex from 'katex'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { Block, MathIR } from '@illus/core'

import { sanitizeKatex, sanitizeMathMl } from '../sanitize.ts'

import { markTexTerms, termClass } from './tex.ts'

export interface MathViewProps {
  ir: MathIR
  block: Block | undefined
  onReady: () => void
}

/** HTML of the formula with term symbols marked by `illus-term-<i>` classes. */
export function formulaHtml(ir: MathIR, block: Block | undefined): string | null {
  const symbols = ir.terms.map((t) => t.symbol)
  const tex = block?.math?.tex
  if (tex) {
    const html = katex.renderToString(markTexTerms(tex, symbols), {
      displayMode: true,
      throwOnError: false,
      output: 'htmlAndMathml',
      trust: (ctx) => ctx.command === '\\htmlClass',
      strict: 'ignore',
    })
    return sanitizeKatex(html)
  }
  const mathml = block?.math?.mathml
  if (mathml) return sanitizeMathMl(mathml)
  return null
}

/** MathML has no `\htmlClass`: mark token elements whose text equals a single-token symbol. */
function markMathMl(root: Element, ir: MathIR) {
  ir.terms.forEach((t, i) => {
    for (const el of root.querySelectorAll('math mi, math mn, math mo')) if (el.textContent?.trim() === t.symbol.trim()) el.classList.add(termClass(i))
  })
}

export function MathView({ ir, block, onReady }: MathViewProps) {
  const formula = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<number | null>(null)
  const html = useMemo(() => formulaHtml(ir, block), [ir, block])

  useEffect(() => {
    const root = formula.current
    if (root && html) {
      root.innerHTML = html // sanitised in formulaHtml
      if (!block?.math?.tex) markMathMl(root, ir)
      // Symbols in the formula are evidence targets too.
      ir.terms.forEach((_, i) =>
        root.querySelectorAll(`.${termClass(i)}`).forEach((el) => {
          el.setAttribute('data-ir-id', `term-${i}`)
          el.setAttribute('data-target', `item:term-${i}`)
        }),
      )
    }
    // KaTeX fonts change the formula's size; report ready (and let the surface fit) once they are in.
    let live = true
    const fonts = typeof document !== 'undefined' && document.fonts ? document.fonts.ready : Promise.resolve()
    void fonts.then(() => live && onReady())
    return () => {
      live = false
    }
  }, [html])

  useEffect(() => {
    const root = formula.current
    if (!root) return
    root.querySelectorAll('.illus-term-active').forEach((el) => el.classList.remove('illus-term-active'))
    if (active !== null) root.querySelectorAll(`.${termClass(active)}`).forEach((el) => el.classList.add('illus-term-active'))
  }, [active, html])

  return (
    <div className="illus-math">
      {html ? (
        <div ref={formula} className="illus-formula" />
      ) : (
        <pre className="illus-formula" style={{ fontFamily: 'var(--illus-mono)' }}>
          {block?.text ?? 'Formula unavailable'}
        </pre>
      )}
      <table className="illus-terms">
        <tbody>
          {ir.terms.map((t, i) => (
            <tr
              key={i}
              data-ir-id={`term-${i}`}
              data-target={`item:term-${i}`}
              className="illus-el"
              tabIndex={0}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <td>{t.symbol}</td>
              <td>{t.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
