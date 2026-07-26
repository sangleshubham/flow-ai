// CFI round-trip in a real browser (§6 step 8, §22 risk "epub.js quirks break CFI mapping"): index the
// synthetic EPUB in Chromium, render every spine item with epub.js exactly as the reader does, resolve each
// block's cfiRange in the rendered iframe and compare the range text with Block.text. Also checks that each
// section's cfiStart lands on its heading and that getSectionAt maps the rendition's location back.
import ePub, { EpubCFI } from '@flow/epubjs'
import { makeBookId, type Block, type SectionNode } from '@illus/core'
import { createMemoryRepos } from '@illus/core/testing'
import { expect, test } from 'vitest'

import { blockTextOfRange, getSectionAt, indexBookStructure } from '../src/index.ts'

declare const __FIXTURE_BOOKS__: string

test('synthetic.epub: block → CFI → rendered range text equals block text', async () => {
  const bytes = new Uint8Array(await (await fetch(`${__FIXTURE_BOOKS__}/synthetic.epub`)).arrayBuffer())
  const bookId = await makeBookId(bytes)
  const book = ePub(bytes.buffer)
  const repos = createMemoryRepos()
  // Real requestIdleCallback slicing (no injected scheduler).
  for await (const _ of indexBookStructure(book, repos, { bookId })) void _
  const sections = await repos.sections.listByBook(bookId)
  const blocks = (await Promise.all(sections.map((s) => repos.blocks.listBySection(s.sectionId)))).flat()
  expect(blocks.length).toBeGreaterThan(100)

  const host = document.createElement('div')
  host.style.cssText = 'width:600px;height:800px'
  document.body.append(host)
  const rendition = book.renderTo(host, { width: 600, height: 800, allowScriptedContent: false } as never)

  const checked = { blocks: 0, sections: 0 }
  const spines = [...new Set(sections.map((s) => s.spineHref))]
  for (const href of spines) {
    await rendition.display(href)
    const doc = (rendition.getContents() as unknown as { document: Document }[])[0]!.document
    const inSpine = (s: { sectionId: string }) => sections.find((x) => x.sectionId === s.sectionId)!.spineHref === href

    for (const block of blocks.filter((b: Block) => inSpine(b))) {
      const range = new EpubCFI(block.cfiRange).toRange(doc)
      expect(range, block.blockId).not.toBeNull()
      expect(blockTextOfRange(range), block.blockId).toBe(block.text)
      checked.blocks++
    }
    for (const section of sections.filter((s: SectionNode) => s.spineHref === href)) {
      const start = new EpubCFI(section.cfiStart).toRange(doc)
      const at = start.startContainer.nodeType === 1 ? (start.startContainer as Element) : start.startContainer.parentElement!
      if (!section.title.includes('(part ') && section.level && at.localName !== 'body') {
        expect(at.closest('h1,h2,h3,h4')?.textContent?.replace(/\s+/g, ' ').trim(), section.sectionId).toBeTruthy()
      }
      expect(getSectionAt(sections, section.cfiStart)?.sectionId).toBe(section.sectionId)
      checked.sections++
    }
    const location = rendition.currentLocation() as unknown as { start: { cfi: string } }
    expect(getSectionAt(sections, location.start.cfi)?.spineHref).toBe(href)
  }
  expect(checked).toEqual({ blocks: blocks.length, sections: sections.length })
  rendition.destroy()
})
