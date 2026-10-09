// @vitest-environment jsdom
// Synthetic cases and their replay blocks use the ids and texts W1's indexer produces for synthetic.epub.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, expect, it } from 'vitest'

import { indexEpub } from '../src/books/index-epub.ts'
import type { IndexedBook } from '../src/books/index-epub.ts'
import { CaseRun, loadCases } from '../src/index.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const cases = loadCases([join(ROOT, 'cases/golden')]).filter((c) => c.bookRef === 'synthetic')
let book: IndexedBook

beforeAll(async () => {
  book = await indexEpub(join(ROOT, '../fixtures/books/synthetic.epub'))
}, 60_000)

it.each(cases.map((c) => [c.id, c] as const))('%s points at an indexed section and real blocks', (_id, c) => {
  expect(book.sections.map((s) => s.sectionId)).toContain(c.sectionId)
  const run = CaseRun.parse(JSON.parse(readFileSync(join(ROOT, 'replay', `${c.id}.json`), 'utf8')))
  const text = new Map(book.blocks.map((b) => [b.blockId, b.text]))
  for (const b of run.blocks) expect(b.text, b.blockId).toBe(text.get(b.blockId))
})
