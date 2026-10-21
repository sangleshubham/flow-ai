import { make } from '@illus/core/testing'
import { describe, expect, it } from 'vitest'

import {
  bookRunBreakdown,
  bookRunEtaMs,
  bookRunPercent,
  filterBookRunGroups,
  formatElapsed,
  formatEta,
  groupBookRunSections,
} from './book-run-view'
import { createBookRunState } from './state'

describe('book run view helpers', () => {
  it('counts each section once, keeping cached and no-visual separate', () => {
    const b = createBookRunState()
    b.sections = {
      a: 'done',
      b: 'cached',
      c: 'no-visual',
      d: 'failed',
      e: 'running',
      f: 'pending',
    }
    b.cachedCount = 99 // The per-section map is current during a run.
    b.failedItems = 9 // Failed items are not failed sections.
    expect(bookRunBreakdown(b)).toEqual({
      new: 1,
      cached: 1,
      noVisual: 1,
      failed: 1,
      pending: 1,
      running: 1,
    })
  })
  it('uses aggregate cache counts before a section map is available', () => {
    const b = {
      ...createBookRunState(),
      finished: 4,
      cachedCount: 3,
      noVisual: 1,
    }
    expect(bookRunBreakdown(b)).toMatchObject({
      new: 1,
      cached: 2,
      noVisual: 1,
    })
  })
  it('hides ETA until two non-cached sections finish and only estimates while illustrating', () => {
    const b = createBookRunState()
    b.status = 'illustrating'
    b.sections = {
      a: 'pending',
      b: 'pending',
      c: 'pending',
      d: 'running',
      e: 'cached',
    }
    b.session = { startedAt: 0, done: 1, avgSectionMs: 480_000 }
    expect(bookRunEtaMs(b)).toBeNull()
    b.session.done = 2
    expect(bookRunEtaMs(b)).toBe(720_000)
    expect(formatEta(bookRunEtaMs(b)!)).toBe('about 12 min left')
    b.status = 'paused'
    expect(bookRunEtaMs(b)).toBeNull()
    b.status = 'illustrating'
    b.session.avgSectionMs = null
    expect(bookRunEtaMs(b)).toBeNull()
  })
  it('bounds percentages and formats elapsed time without negative values', () => {
    expect(bookRunPercent({ finished: 42, total: 100 })).toBe(42)
    expect(bookRunPercent({ finished: 5, total: 0 })).toBe(0)
    expect(bookRunPercent({ finished: 9, total: 3 })).toBe(100)
    expect(formatElapsed(-1)).toBe('0 s')
    expect(formatElapsed(125_000)).toBe('2 min 5 s')
    expect(formatElapsed(3_660_000)).toBe('1 h 1 min')
  })
  it('groups target sections in reading order under their top-level ancestor and falls back to ids', () => {
    const sections = [
      make.sectionNode({
        sectionId: 'child',
        parentId: 'chapter',
        title: 'Child',
        ordinal: 2,
      }),
      make.sectionNode({
        sectionId: 'other',
        title: 'Other chapter',
        ordinal: 3,
      }),
      make.sectionNode({
        sectionId: 'chapter',
        title: 'Chapter one',
        ordinal: 1,
      }),
    ]
    const groups = groupBookRunSections(sections, {
      child: 'running',
      missing: 'pending',
      other: 'done',
    })
    expect(groups.map((g) => g.title)).toEqual([
      'Chapter one',
      'Other chapter',
      'Other sections',
    ])
    expect(groups[0]!.rows[0]).toEqual({
      id: 'child',
      title: 'Child',
      status: 'running',
    })
    expect(groups[2]!.rows[0]!.title).toBe('missing')
  })
  it('filters groups without empty headings; Done includes cached and no visual; Pending includes running', () => {
    const groups = groupBookRunSections([], {
      a: 'failed',
      b: 'pending',
      c: 'running',
      d: 'done',
      e: 'cached',
      f: 'no-visual',
    })
    expect(filterBookRunGroups(groups, 'all')).toBe(groups)
    expect(
      filterBookRunGroups(groups, 'failed')[0]!.rows.map((r) => r.id),
    ).toEqual(['a'])
    expect(
      filterBookRunGroups(groups, 'pending')[0]!.rows.map((r) => r.id),
    ).toEqual(['b', 'c'])
    expect(
      filterBookRunGroups(groups, 'done')[0]!.rows.map((r) => r.id),
    ).toEqual(['d', 'e', 'f'])
    expect(
      filterBookRunGroups(groupBookRunSections([], { a: 'pending' }), 'failed'),
    ).toEqual([])
  })
  it('handles 500 targets and malformed parent cycles without losing targets', () => {
    const sections = Array.from({ length: 500 }, (_, i) =>
      make.sectionNode({
        sectionId: String(i),
        ordinal: i,
        parentId: i === 0 ? '1' : '0',
      }),
    )
    const groups = groupBookRunSections(
      sections,
      Object.fromEntries(
        sections.map((s) => [s.sectionId, 'pending' as const]),
      ),
    )
    expect(groups.flatMap((g) => g.rows)).toHaveLength(500)
  })
})
