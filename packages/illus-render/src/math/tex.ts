// Marks term symbols inside the book's TeX with `\htmlClass` so hovering a term can highlight its symbol
// (§10 math). Token-aware: matches whole TeX tokens, never inside command names or environment names.
// Pure.

export const termClass = (i: number) => `illus-term-${i}`

type Tok = { text: string; space: boolean; term?: number; match?: number }

const TOKEN = /\\[A-Za-z]+|\\.|\s+|./gsu

function tokenize(tex: string): Tok[] {
  return (tex.match(TOKEN) ?? []).map((text) => ({ text, space: /^\s+$/.test(text) }))
}

/** Tokens that cannot sit inside an `\htmlClass{…}{…}` argument without breaking the formula. */
const BARRIER = new Set(['{', '}', '&', '\\\\', '\\left', '\\right', '\\middle', '\\begin', '\\end'])

/** Indices of tokens inside the `{…}` argument right after `\begin` / `\end` (environment names). */
function envNameTokens(toks: Tok[]): Set<number> {
  const out = new Set<number>()
  toks.forEach((t, i) => {
    if (t.text !== '\\begin' && t.text !== '\\end') return
    let j = i + 1
    while (toks[j]?.space) j++
    if (toks[j]?.text !== '{') return
    for (j++; j < toks.length && toks[j]!.text !== '}'; j++) out.add(j)
  })
  return out
}

/**
 * Wraps every occurrence of each symbol in `{\htmlClass{illus-term-i}{…}}`; longer symbols win. The outer
 * braces make the wrapped run a single group, so it stays valid after `^`, `_` or any command.
 */
export function markTexTerms(tex: string, symbols: readonly string[]): string {
  const toks = tokenize(tex)
  const blocked = envNameTokens(toks)
  const solid = toks.map((t, i) => ({ t, i })).filter(({ t }) => !t.space)
  const order = symbols.map((s, i) => ({ i, toks: tokenize(s).filter((t) => !t.space).map((t) => t.text) }))
  order.sort((a, b) => b.toks.length - a.toks.length)
  let matchId = 0
  for (const { i: term, toks: sym } of order) {
    if (sym.length === 0 || sym.some((s) => BARRIER.has(s))) continue
    for (let k = 0; k + sym.length <= solid.length; k++) {
      const run = solid.slice(k, k + sym.length)
      if (run.some(({ t, i }) => t.term !== undefined || blocked.has(i))) continue
      if (!run.every(({ t }, n) => t.text === sym[n])) continue
      matchId++
      for (const { t } of run) {
        t.term = term
        t.match = matchId
      }
      k += sym.length - 1
    }
  }
  let out = ''
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!
    if (t.match === undefined) {
      out += t.text
      continue
    }
    let body = ''
    let j = i
    for (; j < toks.length && (toks[j]!.match === t.match || (toks[j]!.space && toks[j + 1]?.match === t.match)); j++) body += toks[j]!.text
    out += `{\\htmlClass{${termClass(t.term!)}}{${body}}}`
    i = j - 1
  }
  return out
}
