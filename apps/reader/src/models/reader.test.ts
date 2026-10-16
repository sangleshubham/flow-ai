import { describe, expect, it, vi } from 'vitest'

import { BookTab, type ISection } from './reader'

vi.mock('@literal-ui/hooks', () => ({ IS_SERVER: true }))
vi.mock('../db', () => ({ db: null }))
vi.mock('../file', () => ({ fileToEpub: vi.fn() }))
vi.mock('../styles', () => ({ defaultStyle: {} }))

const target = 'epubcfi(/6/2!/4/4)'
function setup() {
  const tab = Object.create(BookTab.prototype) as BookTab
  const events: unknown[][] = []
  const rendition = {
    emit: vi.fn((...args: unknown[]) => events.push(['emit', ...args])),
    display: vi.fn((cfi?: string) => events.push(['display', cfi])),
  }
  tab.rendition = rendition as unknown as BookTab['rendition']
  const showPrevious = vi
    .spyOn(tab, 'showPrevLocation')
    .mockImplementation(() => {})
  return { tab, rendition, events, showPrevious }
}

describe('reader navigation targets (ADR 0053)', () => {
  it('announces a selected heading CFI before display can relocate the reader', () => {
    const x = setup()
    const section = {
      document: { querySelector: vi.fn().mockReturnValue({}) },
      cfiFromElement: vi.fn().mockReturnValue(target),
    } as unknown as ISection
    x.tab.displayFromSelector('#heading', section)
    expect(x.events).toEqual([
      ['emit', 'illus:navigate', target],
      ['display', target],
    ])
    expect(x.showPrevious).toHaveBeenCalledOnce()
  })

  it.each(['chapter.xhtml', undefined])(
    'displays %s through the page rule',
    (href) => {
      const x = setup()
      x.tab.display(href, false)
      expect(x.rendition.emit).not.toHaveBeenCalled()
      expect(x.rendition.display).toHaveBeenCalledWith(href)
      expect(x.showPrevious).not.toHaveBeenCalled()
    },
  )

  it('allows navigation before a rendition is attached', () => {
    const tab = Object.create(BookTab.prototype) as BookTab
    expect(() => tab.display(target, false)).not.toThrow()
  })
})
