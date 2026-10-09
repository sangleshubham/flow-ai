// Text normalisation for grounding (§16 step 1), with an offset map back to the original string so
// matches can be reported as `start`/`end` in the block's own text. W9 reuses it for `quoteToCfi`.

/** Normalised text plus, for each UTF-16 unit `i` of `text`, the original range `[start[i], end[i])`. */
export interface Normalized {
  text: string
  start: number[]
  end: number[]
}

const QUOTES: Record<string, string> = {
  '‘': "'", // ‘
  '’': "'", // ’
  '‚': "'", // ‚
  '‛': "'", // ‛
  '′': "'", // ′
  '“': '"', // “
  '”': '"', // ”
  '„': '"', // „
  '‟': '"', // ‟
  '″': '"', // ″
  '«': '"', // «
  '»': '"', // »
}
const DASHES = /[‐-―−⁃﹘﹣－]/g
/** Soft hyphen plus invisible zero-width characters: dropped wherever they occur, even inside a cluster. */
const INVISIBLE = /[\u00AD\u200B\u200C\u200D\u2060\uFEFF]/
/** A base character with its combining marks, or a run of stray marks; NFKC is applied per cluster. */
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gu

function unify(s: string): string {
  return s.replace(DASHES, '-').replace(/./gsu, (c) => QUOTES[c] ?? c)
}

/**
 * NFKC, lowercase, unified quotes and dashes, soft hyphens removed, whitespace runs collapsed to one
 * space, trimmed (§16 step 1). Idempotent: `normalizeText(normalizeText(s).text).text === normalizeText(s).text`.
 */
export function normalizeText(input: string): Normalized {
  let text = ''
  const start: number[] = []
  const end: number[] = []
  let space: [number, number] | null = null

  // Drop invisible characters first (keeping each remaining unit's original index), so a base letter and
  // a combining mark separated by a soft hyphen still compose.
  let visible = ''
  const at: number[] = []
  for (let i = 0; i < input.length; i++) {
    if (INVISIBLE.test(input[i]!)) continue
    visible += input[i]
    at.push(i)
  }

  for (const m of visible.matchAll(CLUSTER)) {
    const cs = at[m.index]!
    const ce = at[m.index + m[0].length - 1]! + 1
    const out = unify(m[0].normalize('NFKC').toLowerCase())
    if (out.trim() === '') {
      space = space ? [space[0], ce] : [cs, ce]
      continue
    }
    if (space && text) {
      text += ' '
      start.push(space[0])
      end.push(space[1])
    }
    space = null
    for (let i = 0; i < out.length; i++) {
      // NFKC can expand one cluster into several units (ﬁ → fi) or produce inner spaces (½ → 1⁄2 stays,
      // ℡ → tel); collapse any inner whitespace too so the result stays idempotent.
      const ch = /\s/.test(out[i]!) ? ' ' : out[i]!
      if (ch === ' ' && (text.endsWith(' ') || !text)) continue
      text += ch
      start.push(cs)
      end.push(ce)
    }
  }
  while (text.endsWith(' ')) {
    text = text.slice(0, -1)
    start.pop()
    end.pop()
  }
  return { text, start, end }
}

/** Original `[start, end)` of the normalised range `[from, to)` (to > from). */
export function originalRange(n: Normalized, from: number, to: number): { start: number; end: number } {
  return { start: n.start[from]!, end: n.end[to - 1]! }
}

/** Words of a normalised string (split on the single spaces `normalizeText` leaves). */
export function words(normalized: string): string[] {
  return normalized ? normalized.split(' ') : []
}

// Short English stopword list for the relevance check (§16 step 7).
const STOPWORDS = new Set(
  (
    'a an the and or but nor so yet of in on at to for from by with without into onto over under about ' +
    'as is are was were be been being am do does did done has have had having it its this that these those ' +
    'there here then than which who whom whose what when where why how all any each every both either neither ' +
    'some such no not only own same other another more most less least very can could may might must shall ' +
    'should will would i you he she we they me him her us them my your his our their one ones up down out off ' +
    'again further once also just if else while until because per via new old'
  ).split(' '),
)

/** Crude plural stemming so 'followers' matches 'follower' and 'entries' matches 'entry'. */
function stem(w: string): string {
  if (w.endsWith("'s")) w = w.slice(0, -2)
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

/** Non-stopword terms of a label, normalised and stemmed. */
export function contentTerms(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of normalizeText(text).text.split(/[^\p{L}\p{N}_']+/u)) {
    const t = w.replace(/^'+|'+$/g, '')
    if (t && !STOPWORDS.has(t)) out.add(stem(t))
  }
  return out
}
