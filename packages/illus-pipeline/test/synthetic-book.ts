// Indexes fixtures/books/synthetic.epub with W1's structural indexer (epub.js in jsdom) into in-memory
// repositories, for the replay integration test and the fixture generator.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Test-only (devDependency): epub.js opens the fixture book; @illus/pipeline never imports it at runtime.
import ePub from '@flow/epubjs'
import { buildLexicalIndex, indexBookStructure } from '@illus/book-index'
import { makeBookId } from '@illus/core'
import type { Block, IllusRepos, SectionNode } from '@illus/core'
import { createMemoryRepos } from '@illus/core/testing'

export const ROOT = join(import.meta.dirname, '../../..')

export interface IndexedBook {
  bookId: string
  repos: IllusRepos
  sections: SectionNode[]
  blocks: Block[]
  lexical: ReturnType<typeof buildLexicalIndex>
  /** Section by its title without the heading indentation, e.g. '2.1 Formulas'. */
  byTitle(title: string): SectionNode
}

export async function indexSyntheticBook(): Promise<IndexedBook> {
  // epub.js turns archived resources into blob: URLs, which jsdom cannot make; the indexer never needs them.
  URL.createObjectURL = () => 'blob:test'
  const bytes = new Uint8Array(readFileSync(join(ROOT, 'fixtures/books/synthetic.epub')))
  const book = ePub({ replacements: 'none' } as never)
  await book.open(bytes.buffer as ArrayBuffer)
  const bookId = await makeBookId(bytes)
  const repos = createMemoryRepos()
  const scheduler = (run: (d: { timeRemaining(): number }) => void) => run({ timeRemaining: () => Infinity })
  for await (const _ of indexBookStructure(book, repos, { bookId, scheduler, now: () => 1 }));
  const sections = await repos.sections.listByBook(bookId)
  const blocks = (await Promise.all(sections.map((s) => repos.blocks.listBySection(s.sectionId)))).flat()
  return {
    bookId,
    repos,
    sections,
    blocks,
    lexical: buildLexicalIndex(blocks, sections),
    byTitle(title) {
      const s = sections.find((x) => x.title.trim() === title)
      if (!s) throw new Error(`no section titled ${title}`)
      return s
    },
  }
}
