// Handwritten responses for exact captured requests from synthetic.epub, never a runtime fallback.
import type { LlmRequest } from '@illus/core'

import type { IndexedBook } from '../synthetic-book.ts'
import { BOOK_SUMMARY, EXTRACTS, GLOSSARY, INDEX, PLANS, sectionKey } from './synthetic-calls.ts'

export const BROWSER_ROLES = ['indexer', 'glossary', 'book-summary', 'planner', 'extractor.graph', 'extractor.mermaid', 'extractor.template', 'extractor.chart', 'extractor.math', 'extractor.timeline'] as const

function resolve<T>(value: T, sectionId: string): T {
  return JSON.parse(JSON.stringify(value), (_key, v: unknown) => typeof v === 'string' && /^@b\d+$/.test(v) ? `${sectionId}#${v.slice(1)}` : v) as T
}

export function browserAnswer(book: IndexedBook, request: LlmRequest): unknown {
  const ids = [...request.body.matchAll(/<section id="([^"]+)"/g)].map((match) => match[1]!)
  const section = (id: string) => {
    const found = book.sections.find((entry) => entry.sectionId === id)
    if (!found) throw new Error(`capture does not refer to synthetic.epub section ${id}`)
    return found
  }
  const key = (id: string) => {
    const found = sectionKey(section(id), book.sections)
    if (!found) throw new Error(`no handwritten browser response for ${section(id).title}`)
    return found
  }
  if (request.role === 'indexer') return { sections: ids.map((id) => resolve({ sectionId: id, ...INDEX[key(id)] }, id)) }
  if (request.role === 'glossary') return GLOSSARY
  if (request.role === 'book-summary') return /Chapter 4/.test(request.body) ? BOOK_SUMMARY.final : BOOK_SUMMARY.early
  const id = ids[0]!
  const name = key(id)
  if (request.role === 'planner') {
    const authored = PLANS[name]
    if (authored) return resolve({ sectionId: id, ...authored }, id)
    if (name === 'preface') return { sectionId: id, needsVisual: false, reason: 'The preface describes the test fixture and its CC0 license.', items: [] }
    throw new Error(`author a browser planner response for ${section(id).title}`)
  }
  const item = /<plan_item id="([^"]+)"/.exec(request.body)?.[1]
  const answer = EXTRACTS[`${name}|${item}`]
  if (!answer) throw new Error(`author a browser ${request.role} response for ${section(id).title} item ${item}`)
  return resolve(answer, id)
}
