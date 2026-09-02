// Indexes an EPUB file with W1's structural indexer (epub.js over jsdom) into in-memory repositories,
// for the live runner and the case-id checks. Node only.
import { readFileSync } from 'node:fs'

import ePub from '@flow/epubjs'
import { buildLexicalIndex, indexBookStructure } from '@illus/book-index'
import { makeBookId } from '@illus/core'
import type { Block, IllusRepos, SectionNode } from '@illus/core'
import { createMemoryRepos } from '@illus/core/testing'
import { JSDOM } from 'jsdom'

export interface IndexedBook {
  bookId: string
  title: string
  repos: IllusRepos
  sections: SectionNode[]
  blocks: Block[]
  lexical: ReturnType<typeof buildLexicalIndex>
}

/** epub.js needs a DOM. Under vitest's jsdom environment one exists; in the CLI we install jsdom's globals. */
function ensureDom(): void {
  if (typeof document === 'undefined') {
    const { window } = new JSDOM('')
    const g = globalThis as Record<string, unknown>
    for (const key of Object.getOwnPropertyNames(window)) if (!(key in g)) g[key] = (window as unknown as Record<string, unknown>)[key]
    g.window = window
    g.document = window.document
  }
  // epub.js turns archived resources into blob: URLs, which jsdom cannot make; the indexer never needs them.
  URL.createObjectURL = () => 'blob:eval'
}

export async function indexEpub(file: string): Promise<IndexedBook> {
  ensureDom()
  const bytes = new Uint8Array(readFileSync(file))
  const book = ePub({ replacements: 'none' } as never)
  await book.open(bytes.buffer as ArrayBuffer)
  const bookId = await makeBookId(bytes)
  const repos = createMemoryRepos()
  const scheduler = (run: (d: { timeRemaining(): number }) => void) => run({ timeRemaining: () => Infinity })
  for await (const _ of indexBookStructure(book, repos, { bookId, scheduler, now: () => 1 }));
  const sections = await repos.sections.listByBook(bookId)
  const blocks = (await Promise.all(sections.map((s) => repos.blocks.listBySection(s.sectionId)))).flat()
  const meta = await repos.books.get(bookId)
  return { bookId, title: meta?.title ?? bookId, repos, sections, blocks, lexical: buildLexicalIndex(blocks, sections) }
}
