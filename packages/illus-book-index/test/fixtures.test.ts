// End to end over real EPUBs with epub.js in jsdom: every fixture book in fixtures/books/ (not private/)
// gets a snapshot of its section tree and blocks. Plus INDEX_VERSION handling (§6 step 1).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import ePub, { type Book } from '@flow/epubjs'
import { makeBookId } from '@illus/core'
import { createMemoryRepos } from '@illus/core/testing'
import { beforeAll, describe, expect, test, vi } from 'vitest'

import { INDEX_VERSION, indexBookStructure, type IndexRepos, type Progress } from '../src/index.ts'
import { syncScheduler } from './helpers.ts'

const BOOKS = join(import.meta.dirname, '../../../fixtures/books')
const fixtures = readdirSync(BOOKS).filter((f) => f.endsWith('.epub'))

beforeAll(() => {
  // epub.js turns archived images into blob: URLs, which jsdom cannot make; the indexer never needs them.
  URL.createObjectURL = () => 'blob:test'
})

async function open(file: string): Promise<{ book: Book; bookId: string }> {
  const bytes = new Uint8Array(readFileSync(join(BOOKS, file)))
  const book = ePub({ replacements: 'none' } as never)
  await book.open(bytes.buffer as ArrayBuffer)
  return { book, bookId: await makeBookId(bytes) }
}

async function run(book: Book, repos: IndexRepos, bookId: string): Promise<Progress[]> {
  const progress: Progress[] = []
  for await (const p of indexBookStructure(book, repos, { bookId, scheduler: syncScheduler, now: () => 1 })) progress.push(p)
  return progress
}

const clip = (s: string) => (s.length > 120 ? `${s.slice(0, 120)}… (${s.length} chars)` : s)

describe.each(fixtures)('%s', (file) => {
  test('indexes to the snapshot', async () => {
    const { book, bookId } = await open(file)
    const repos = createMemoryRepos()
    const progress = await run(book, repos, bookId)
    expect(progress.at(-1)).toMatchObject({ phase: 'done', skipped: false })

    const sections = await repos.sections.listByBook(bookId)
    const tree = sections.map((s) => ({ ...s, title: `${'  '.repeat(s.level - 1)}${s.title}` }))
    expect(tree).toMatchSnapshot('sections')
    const blocks = (await Promise.all(sections.map((s) => repos.blocks.listBySection(s.sectionId)))).flat()
    expect(blocks.map((b) => ({ ...b, text: clip(b.text), ...(b.table && { table: { ...b.table, html: clip(b.table.html) } }) }))).toMatchSnapshot('blocks')
    const refs = (await Promise.all(blocks.map((b) => repos.crossRefs.listFromBlock(b.blockId)))).flat()
    expect(refs).toMatchSnapshot('crossRefs')
    expect(await repos.books.get(bookId)).toMatchObject({ indexStatus: 'structural', indexVersion: INDEX_VERSION, sectionCount: sections.length })
  })
})

describe('synthetic.epub edge cases', () => {
  let sections: Awaited<ReturnType<IndexRepos['sections']['listByBook']>>
  let repos: ReturnType<typeof createMemoryRepos>
  beforeAll(async () => {
    const { book, bookId } = await open('synthetic.epub')
    repos = createMemoryRepos()
    await run(book, repos, bookId)
    sections = await repos.sections.listByBook(bookId)
  })
  const titled = (t: string) => sections.find((s) => s.title === t)!

  test('no-heading spine item takes its TOC title', () => {
    expect(sections[0]).toMatchObject({ title: 'Preface', spineIndex: 0, level: 1 })
  })
  test('the tiny section 2.3 is merged into 2.3.1', () => {
    expect(titled('2.3 A Tiny Section').mergedInto).toBe(titled('2.3.1 Straight Into a Subheading').sectionId)
  })
  test('3.1 splits by paragraphs, 3.2 at its h5 headings', () => {
    expect(sections.filter((s) => s.title.startsWith('3.1 ')).length).toBeGreaterThan(2)
    expect(sections.filter((s) => s.title.startsWith('3.2 ')).map((s) => s.title)).toEqual([
      '3.2 An Oversized Section With h5 Subheadings (part 1)',
      '3.2 An Oversized Section With h5 Subheadings (part 2)',
      '3.2 An Oversized Section With h5 Subheadings (part 3)',
    ])
    expect(sections.every((s) => s.tokenEstimate <= 6000)).toBe(true)
  })
  test('the scripted chapter is indexed as text, the script ignored', async () => {
    const [block] = await repos.blocks.listBySection(titled('Chapter 4 Scripted Content').sectionId)
    expect(block!.text).toBe('If this sentence changes, a script inside the book ran.')
  })
})

describe('INDEX_VERSION (§6 step 1)', () => {
  test('re-opening an indexed book with the same INDEX_VERSION does no work', async () => {
    const { book, bookId } = await open('synthetic.epub')
    const repos = createMemoryRepos()
    await run(book, repos, bookId)

    const spies = [
      vi.spyOn(book.spine, 'each'),
      vi.spyOn(book, 'load'),
      vi.spyOn(repos, 'transaction'),
      vi.spyOn(repos.sections, 'bulkPut'),
      vi.spyOn(repos.sections, 'deleteByBook'),
      vi.spyOn(repos.books, 'put'),
    ]
    const progress = await run(book, repos, bookId)
    expect(progress).toEqual([{ phase: 'done', skipped: true, sectionCount: (await repos.sections.listByBook(bookId)).length }])
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  test('an older stored version is re-indexed and replaces the old records; other book fields survive', async () => {
    const { book, bookId } = await open('synthetic.epub')
    const repos = createMemoryRepos()
    const summary = { summary: 'A small book.', conventions: [] }
    await repos.books.put({ bookId, title: 'Mine', indexStatus: 'complete', indexVersion: INDEX_VERSION - 1, summary, createdAt: 0, updatedAt: 0 })
    await repos.sections.put({ ...(await firstSection(book, bookId)), sectionId: `${bookId}:9:stale:0` })

    const progress = await run(book, repos, bookId)
    expect(progress.at(-1)).toMatchObject({ phase: 'done', skipped: false })
    expect(progress.filter((p) => p.phase === 'persist')).toHaveLength(5)
    const sections = await repos.sections.listByBook(bookId)
    expect(sections.some((s) => s.sectionId.includes(':stale:'))).toBe(false)
    expect(await repos.books.get(bookId)).toMatchObject({ title: 'Mine', summary, indexStatus: 'structural', indexVersion: INDEX_VERSION, createdAt: 0 })
  })

  test('a book stored with indexStatus "none" is indexed', async () => {
    const { book, bookId } = await open('synthetic.epub')
    const repos = createMemoryRepos()
    await repos.books.put({ bookId, title: '', indexStatus: 'none', indexVersion: INDEX_VERSION, createdAt: 0, updatedAt: 0 })
    expect((await run(book, repos, bookId)).at(-1)).toMatchObject({ skipped: false })
  })
})

async function firstSection(book: Book, bookId: string) {
  const repos = createMemoryRepos()
  await run(book, repos, bookId)
  return (await repos.sections.listByBook(bookId))[0]!
}
