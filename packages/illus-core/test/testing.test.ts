import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { IR, sectionContentHash, SectionNode } from '../src/index.ts'
import type { Evidence } from '../src/index.ts'
import {
  buildAllIRs,
  buildPlan,
  buildSection,
  buildSmallBook,
  createMemoryRepos,
  FIXED_NOW,
  make,
  SECTION_COMMIT_ID,
  SECTION_LEADERS_ID,
  SMALL_BOOK_ID,
} from '../src/testing/index.ts'

function collectEvidence(value: unknown, out: Evidence[] = []): Evidence[] {
  if (Array.isArray(value)) value.forEach((v) => collectEvidence(v, out))
  else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (typeof o.blockId === 'string' && typeof o.quote === 'string') out.push(o as unknown as Evidence)
    Object.values(o).forEach((v) => collectEvidence(v, out))
  }
  return out
}

describe('small book builders', () => {
  it('builds an array template with list-form pointers and evidence paths that resolve', () => {
    const ir = make.templateIR()
    const props = z
      .object({
        values: z.array(z.number()),
        pointers: z.array(z.object({ name: z.string(), index: z.number().int() })),
      })
      .parse(ir.props)
    expect(props.pointers).toEqual([{ name: 'majority', index: 1 }])
    expect(ir.evidence.map(({ path }) => path)).toEqual(['values', 'pointers.0'])
    for (const { path } of ir.evidence) {
      const element = path
        .split('.')
        .reduce<unknown>(
          (value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
          props,
        )
      expect(element, path).toBeDefined()
    }
  })

  it('builds sections with real content hashes over their blocks', async () => {
    const book = await buildSmallBook()
    expect(book.sections.map((s) => SectionNode.parse(s).ordinal)).toEqual([0, 1, 2])
    for (const s of book.sections) {
      const texts = book.blocks.filter((b) => b.sectionId === s.sectionId).map((b) => b.text)
      expect(s.contentHash).toBe(await sectionContentHash(texts))
      expect(s.blockIds).toHaveLength(texts.length)
    }
    const { section, blocks } = await buildSection(SECTION_COMMIT_ID)
    expect(section.number).toBe('5.2')
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'code', 'math', 'figure'])
  })

  it('grounds every evidence quote of every factory verbatim in the small book', async () => {
    const { blocks } = await buildSmallBook()
    const text = new Map(blocks.map((b) => [b.blockId, b.text]))
    const evidence = collectEvidence([buildAllIRs(), make.animationIR(), make.patchOutput(), make.sectionIndex(), make.concept()])
    expect(evidence.length).toBeGreaterThan(40)
    for (const e of evidence) expect(text.get(e.blockId), e.quote).toContain(e.quote)
  })

  it('builds plans and IRs that parse', () => {
    expect(buildPlan([{}, { kind: 'trace', codeBlockId: `${SECTION_COMMIT_ID}#b1`, animate: false }]).items).toHaveLength(2)
    for (const ir of buildAllIRs()) expect(IR.parse(ir)).toEqual(ir)
  })
})

describe('memory repos', () => {
  it('stores clones and validates on write', async () => {
    const repos = createMemoryRepos()
    const book = make.bookMeta()
    await repos.books.put(book)
    const got = (await repos.books.get(book.bookId))!
    got.title = 'mutated'
    expect((await repos.books.get(book.bookId))!.title).toBe(book.title)
    await expect(repos.books.put({ ...book, bookId: 'not-hex' })).rejects.toThrow()
    await repos.books.setSummary(book.bookId, make.bookSummary())
    expect((await repos.books.listByIndexStatus('structural'))[0]!.summary).toBeDefined()
  })

  it('lists sections in reading order and blocks in block order, and deletes per book', async () => {
    const repos = createMemoryRepos()
    const book = await buildSmallBook()
    await repos.transaction(['sections', 'blocks', 'crossRefs'], async () => {
      await repos.sections.bulkPut([...book.sections].reverse())
      await repos.blocks.bulkPut([...book.blocks].reverse())
      await repos.crossRefs.bulkAdd(book.crossRefs)
    })
    expect((await repos.sections.listByBook(SMALL_BOOK_ID)).map((s) => s.ordinal)).toEqual([0, 1, 2])
    expect((await repos.sections.getByOrdinal(SMALL_BOOK_ID, 2))!.sectionId).toBe(SECTION_COMMIT_ID)
    const blocks = await repos.blocks.listBySection(SECTION_LEADERS_ID)
    expect(blocks.map((b) => b.blockId.split('#b')[1])).toEqual(['0', '1', '2', '3', '4'])
    expect(await repos.crossRefs.listToSection(SECTION_COMMIT_ID)).toHaveLength(1)
    await Promise.all([repos.sections.deleteByBook(SMALL_BOOK_ID), repos.blocks.deleteByBook(SMALL_BOOK_ID), repos.crossRefs.deleteByBook(SMALL_BOOK_ID)])
    expect(await repos.sections.listByBook(SMALL_BOOK_ID)).toEqual([])
    expect(await repos.blocks.listBySection(SECTION_LEADERS_ID)).toEqual([])
    expect(await repos.crossRefs.listToSection(SECTION_COMMIT_ID)).toEqual([])
  })

  it('implements the index lookups of every cache store', async () => {
    const repos = createMemoryRepos()
    await repos.concepts.put(make.concept())
    expect(await repos.concepts.findByName(SMALL_BOOK_ID, 'leader server')).toHaveLength(1)
    await repos.plans.put(make.planRecord())
    expect(await repos.plans.listBySection(SMALL_BOOK_ID, SECTION_LEADERS_ID)).toHaveLength(1)
    await repos.visuals.put(make.visualRecord())
    expect(await repos.visuals.listByPlanItem('p1')).toHaveLength(1)
    await repos.traces.put(make.traceRecord())
    expect(await repos.traces.listByCodeBlock(`${SECTION_COMMIT_ID}#b1`)).toHaveLength(1)
    await repos.conceptModels.put(make.conceptModel())
    expect(await repos.conceptModels.listByConcept(make.concept().conceptId)).toHaveLength(1)
    await repos.sectionIndex.put(make.sectionIndexRecord())
    expect(await repos.sectionIndex.countByBook(SMALL_BOOK_ID)).toBe(1)
  })

  it('auto-increments llmLog ids, lists newest first, and stores settings', async () => {
    const repos = createMemoryRepos()
    expect(await repos.llmLog.add(make.llmLogEntry())).toBe(1)
    expect(await repos.llmLog.add(make.llmLogEntry({ role: 'critic', effort: 'low', createdAt: FIXED_NOW + 1 }))).toBe(2)
    expect((await repos.llmLog.list()).map((e) => e.id)).toEqual([2, 1])
    expect(await repos.llmLog.list({ role: 'planner' })).toHaveLength(1)
    await repos.settings.set('flags', { critic: true })
    expect(await repos.settings.get('flags')).toEqual({ critic: true })
    expect(await repos.settings.list()).toEqual([{ key: 'flags', value: { critic: true } }])
  })
})
