import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeBookId, parseSectionId } from '@illus/core'
import { smallBookBlocks } from '@illus/core/testing'
import { describe, expect, it } from 'vitest'

import { EVAL_MINI_SECTIONS } from '../src/books/eval-mini.ts'
import { CaseRun, loadCases } from '../src/index.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const cases = loadCases([join(ROOT, 'cases/golden')])
const runOf = (id: string) => CaseRun.parse(JSON.parse(readFileSync(join(ROOT, 'replay', `${id}.json`), 'utf8')))

describe('golden cases', () => {
  it('has at least 12 cases across the §18 categories', () => {
    expect(cases.length).toBeGreaterThanOrEqual(12)
    expect(new Set(cases.map((c) => c.category)).size).toBeGreaterThanOrEqual(6)
  })

  it('has a handwritten replay recording for every case', () => {
    for (const c of cases) {
      expect(existsSync(join(ROOT, 'replay', `${c.id}.json`)), c.id).toBe(true)
      expect(runOf(c.id)).toMatchObject({ caseId: c.id, source: 'handwritten' })
    }
  })

  it('synthetic cases point at the bookId of fixtures/books/synthetic.epub', async () => {
    const bookId = await makeBookId(new Uint8Array(readFileSync(join(ROOT, '../fixtures/books/synthetic.epub'))))
    for (const c of cases.filter((x) => x.bookRef === 'synthetic')) expect(parseSectionId(c.sectionId)?.bookId, c.id).toBe(bookId)
  })

  it('replay blocks match their source books (no drift)', () => {
    const source = new Map<string, string>([
      ...smallBookBlocks().map((b) => [b.blockId, b.text] as const),
      ...EVAL_MINI_SECTIONS.flatMap((s) => s.blocks.map((b) => [b.blockId, b.text] as const)),
    ])
    for (const c of cases.filter((x) => x.bookRef === 'small-book' || x.bookRef === 'eval-mini'))
      for (const b of runOf(c.id).blocks) expect(b.text, `${c.id} ${b.blockId}`).toBe(source.get(b.blockId))
  })
})
