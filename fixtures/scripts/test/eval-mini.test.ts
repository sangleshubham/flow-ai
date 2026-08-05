// eval-mini.epub is up to date, and @illus/book-index turns it back into exactly the sections and blocks of
// evals/src/books/eval-mini.ts, ids included, so the eval cases' sectionIds/blockIds are the indexer's.
import { readFileSync } from 'node:fs'

import ePub from '@flow/epubjs'
import { indexBookStructure } from '@illus/book-index'
import { createMemoryRepos } from '@illus/core/testing'
import { beforeAll, expect, test } from 'vitest'

import { EVAL_MINI_BOOK_ID, EVAL_MINI_SECTIONS } from '../../../evals/src/books/eval-mini.ts'
import { buildEvalMiniEpub, EVAL_MINI_EPUB } from '../make-eval-mini-epub.ts'

beforeAll(() => {
  // epub.js turns archived resources into blob: URLs, which jsdom cannot make; the indexer never needs them.
  URL.createObjectURL = () => 'blob:test'
})

test('the committed eval-mini.epub matches its builder (run `pnpm fixtures:epub`)', async () => {
  expect(Buffer.from(await buildEvalMiniEpub()).equals(readFileSync(EVAL_MINI_EPUB))).toBe(true)
})

test('@illus/book-index yields the eval-mini sections and blocks', async () => {
  const bytes = new Uint8Array(readFileSync(EVAL_MINI_EPUB))
  const book = ePub({ replacements: 'none' } as never)
  await book.open(bytes.buffer as ArrayBuffer)
  const repos = createMemoryRepos()
  const scheduler = (run: (d: { timeRemaining(): number }) => void) => run({ timeRemaining: () => Infinity })
  for await (const _ of indexBookStructure(book, repos, { bookId: EVAL_MINI_BOOK_ID, scheduler, now: () => 1 }));

  const sections = await repos.sections.listByBook(EVAL_MINI_BOOK_ID)
  const indexed = await Promise.all(
    sections.map(async (s) => ({
      sectionId: s.sectionId,
      title: s.title,
      blocks: (await repos.blocks.listBySection(s.sectionId)).map((b) => ({ blockId: b.blockId, kind: b.kind, text: b.text })),
    })),
  )
  // Contracts v1.2: code blocks keep line breaks and indentation, so every block must match exactly.
  expect(indexed).toEqual(EVAL_MINI_SECTIONS)
})
