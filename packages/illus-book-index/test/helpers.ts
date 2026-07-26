// Test helpers: XHTML documents parsed by jsdom, walked and built like a real spine.
import { buildStructure, type TocItem } from '../src/build.ts'
import { runInSlices, type IdleScheduler } from '../src/index-book.ts'
import { walkDocument } from '../src/walk.ts'

export const BOOK_ID = '00112233aabbccdd'

/** Runs every slice at once (no timers). */
export const syncScheduler: IdleScheduler = (run) => run({ timeRemaining: () => Infinity })

export function xhtml(body: string, title = 'Doc'): Document {
  const src = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head>
<body>${body}</body></html>`
  const doc = new DOMParser().parseFromString(src, 'application/xhtml+xml')
  const err = doc.querySelector('parsererror')
  if (err) throw new Error(err.textContent ?? 'parse error')
  return doc
}

export interface DocInput {
  href: string
  body: string
  title?: string
}

/** Walks and builds a book made of the given documents (spine order). */
export async function indexDocs(docs: readonly (DocInput | string)[], toc: TocItem[] = []) {
  const spines = []
  for (const [i, d] of docs.entries()) {
    const { href, body, title } = typeof d === 'string' ? { href: `ch${i}.xhtml`, body: d, title: undefined } : d
    const doc = xhtml(body, title)
    const { docTitle, sections } = await runInSlices(walkDocument(doc, `/6/${2 * (i + 1)}`), syncScheduler)
    spines.push({ spineIndex: i, spineHref: href, docTitle, sections })
  }
  return buildStructure(BOOK_ID, spines, toc)
}

/** Blocks of one document, as [kind, text] pairs (most rule tests need only these). */
export async function kinds(body: string) {
  const { blocks } = await indexDocs([body])
  return blocks.map((b) => [b.kind, b.text])
}

/** Prose of about `tokens` tokens (3.6 chars per token) as `<p>` elements of ~100 tokens each. */
export function prose(tokens: number, word = 'lorem'): string {
  const para = Array.from({ length: 60 }, () => word).join(' ') // 60 × 6 − 1 chars ≈ 100 tokens
  return Array.from({ length: Math.ceil(tokens / 100) }, () => `<p>${para}</p>`).join('\n')
}
