import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { make, SECTION_LEADERS_ID, SMALL_BOOK_ID } from '@illus/core/testing'
import { describe, expect, it } from 'vitest'

import { feedbackCases, loadCases } from '../src/index.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ir = make.graphIR()
const node = ir.nodes[0]!

function cacheFile(bookId: string, visuals: unknown[]) {
  return {
    format: 'illus-cache',
    version: 1,
    bookId,
    stores: { books: [{ title: 'My Book' }], sections: [{ sectionId: SECTION_LEADERS_ID, title: '  5.1 Leaders and Followers' }], visuals },
  }
}

const up = make.visualRecord({ cacheKey: 'k-up', sectionId: SECTION_LEADERS_ID, kind: 'graph', ir, feedback: { vote: 'up' } })
const down = make.visualRecord({ cacheKey: 'k-down', sectionId: SECTION_LEADERS_ID, kind: 'graph', ir, feedback: { vote: 'down', note: 'arrows reversed' } })
const wrong = make.visualRecord({
  cacheKey: 'k-wrong',
  sectionId: SECTION_LEADERS_ID,
  kind: 'graph',
  ir,
  elementReports: [{ elementId: node.id, note: 'not in this section', createdAt: 1 }],
})

describe('feedback export (§16 L6)', () => {
  it('turns thumbs-down and element reports into regression cases, and skips thumbs-up', async () => {
    const out = await feedbackCases(cacheFile(SMALL_BOOK_ID, [up, down, wrong]))
    expect(out).toHaveLength(2)
    const [d, w] = out.map((o) => o.case)
    expect(d).toMatchObject({ bookRef: 'small-book', category: 'architecture', source: 'regression', title: '5.1 Leaders and Followers', expected: { needsVisual: true, acceptableKinds: ['graph'], mustNotInclude: [] } })
    expect(d!.notes).toContain('Thumbs down: arrows reversed.')
    expect(w!.expected.mustNotInclude).toEqual([node.label])
    expect(w!.notes).toContain(`Wrong ${node.id} (${node.label}): not in this section`)
    expect(out.every((o) => !o.private)).toBe(true)
  })

  it('marks cases of books outside the repository private', async () => {
    const [c] = await feedbackCases(cacheFile('00000000000000aa', [down]))
    expect(c).toMatchObject({ private: true, case: { bookRef: 'private:My Book' } })
    const [d] = await feedbackCases(cacheFile('00000000000000aa', [down]), { bookRef: 'private:mine.epub' })
    expect(d!.case.bookRef).toBe('private:mine.epub')
  })

  it('pnpm illus:export-feedback writes loadable cases once and keeps existing ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'illus-feedback-'))
    const file = join(dir, 'cache.json')
    writeFileSync(file, JSON.stringify(cacheFile('00000000000000aa', [down])))
    const run = () => execFileSync(process.execPath, [join(ROOT, 'bin/run.mjs'), join(ROOT, 'src/export-feedback.ts'), file, '--out', join(dir, 'out')], { encoding: 'utf8' })
    expect(run()).toMatch(/1 new regression case/)
    expect(run()).toMatch(/0 new regression case\(s\), 1 already present/)
    expect(existsSync(join(dir, 'out/private'))).toBe(true)
    expect(loadCases([join(dir, 'out/private')])[0]!.source).toBe('regression')
    expect(readFileSync(file, 'utf8')).toContain('illus-cache')
  })
})
