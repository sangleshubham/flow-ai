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
  // §5/§6 step 9 collapse whitespace in every block, code included, so the indexer flattens the listing's
  // line breaks and indentation while eval-mini keeps them. Open contract question in ADR 0008.
  const collapsed = EVAL_MINI_SECTIONS.map((s) => ({
    ...s,
    blocks: s.blocks.map((b) => (b.kind === 'code' ? { ...b, text: b.text.replace(/\s+/g, ' ').trim() } : b)),
  }))
  expect(indexed).toEqual(collapsed)
})
