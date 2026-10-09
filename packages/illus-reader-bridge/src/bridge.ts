import { EpubCFI } from '@flow/epubjs'
import { getSectionAt, getSectionForPage } from '@illus/book-index'
import type {
  Block,
  ReaderBridge,
  ReaderLocation,
  ReaderSelection,
  SectionNode,
  ThemeTokens,
} from '@illus/core'
import { quoteRange } from './range.ts'

const cmp = new EpubCFI()

export const LOCATION_DEBOUNCE_MS = 400
export interface BridgeContents {
  document: Document
  sectionIndex: number
  range(cfi: string): Range
  cfiFromRange(range: Range): string
}
export interface BridgeRendition {
  on(event: string, cb: (...args: never[]) => void): unknown
  off(event: string, cb: (...args: never[]) => void): unknown
  display(cfi: string): Promise<unknown>
  currentLocation(): unknown
  getContents(): BridgeContents[]
  annotations: {
    highlight(
      cfi: string,
      data?: object,
      cb?: () => void,
      className?: string,
      styles?: object,
    ): unknown
    remove(cfi: string, type: string): unknown
  }
}
export interface BridgeOptions {
  bookId: string
  rendition: BridgeRendition
  sections: () => readonly SectionNode[]
  blocks: () => readonly Block[]
  themeRoot?: HTMLElement
}
export interface ManagedReaderBridge extends ReaderBridge {
  dispose(): void
  refreshLocation(): void
  setTarget(cfi: string): void
}

/** Adapter owns all event listeners and ephemeral marks; dispose when the focused book changes. */
export function createReaderBridge(o: BridgeOptions): ManagedReaderBridge {
  const locations = new Set<(l: ReaderLocation) => void>()
  const selections = new Set<(s: ReaderSelection) => void>()
  const themes = new Set<(t: ThemeTokens) => void>()
  const highlights = new Map<string, 'evidence' | 'step'>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let last: string | null | undefined
  let current = ''
  let currentEnd: string | undefined
  let target: string | undefined
  let targetSeen = false
  let disposed = false
  const root = o.themeRoot ?? document.documentElement
  const theme = (): ThemeTokens => {
    const css = getComputedStyle(root)
    const colour = (key: string, fallback: string) => {
      const value = css.getPropertyValue(`--md-sys-color-${key}`).trim()
      return value ? `rgb(${value})` : fallback
    }
    return {
      bg: colour('surface', '#ffffff'),
      fg: colour('on-surface', '#202124'),
      muted: colour('on-surface-variant', '#555'),
      line: colour('outline-variant', '#ccc'),
      accent: colour('primary', '#0667bb'),
      new: colour('tertiary', '#725573'),
      earlier: colour('outline', '#73777c'),
      highlight: colour('primary-container', '#dcecff'),
      font:
        css.getPropertyValue('--md-sys-typescale-body-medium-family').trim() ||
        'Roboto, sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      dark: root.classList.contains('dark'),
    }
  }
  const inner = (cfi: string) => cfi.replace(/^epubcfi\(|\)$/g, '')
  /** EpubCFI.compare orders an element before the text inside it, so a heading's element CFI (a TOC
   *  target, `/4/8`) sorts before a page that starts in its text (`/4/8/1:0`). Containment counts as on the page. */
  const contains = (outer: string, cfi: string) => {
    const a = inner(outer)
    const b = inner(cfi)
    return (
      b.startsWith(a) &&
      (b.length === a.length || '/:!['.includes(b[a.length]!))
    )
  }
  const onPage = (cfi: string) =>
    !!current &&
    !!currentEnd &&
    (cmp.compare(current, cfi) <= 0 || contains(cfi, current)) &&
    cmp.compare(cfi, currentEnd) <= 0
  const setTarget = (cfi: string) => {
    target = cfi
    targetSeen = false
    last = undefined
  }
  const navigate = (cfi: unknown) => {
    if (typeof cfi === 'string' && cfi.startsWith('epubcfi(')) setTarget(cfi)
  }
  const publish = () => {
    if (!current || disposed) return
    let section =
      target && onPage(target)
        ? getSectionAt(o.sections(), target)
        : getSectionForPage(o.sections(), current, currentEnd)
    const seen = new Set<string>()
    while (section?.mergedInto && !seen.has(section.sectionId)) {
      seen.add(section.sectionId)
      section =
        o.sections().find((s) => s.sectionId === section!.mergedInto) ?? section
    }
    const sectionId = section?.sectionId ?? null
    if (last === sectionId) return
    last = sectionId
    for (const cb of locations)
      cb({ bookId: o.bookId, cfi: current, sectionId })
  }
  const relocated = (loc: {
    start?: { cfi?: string }
    end?: { cfi?: string }
  }) => {
    if (!loc?.start?.cfi) return
    current = loc.start.cfi
    currentEnd = loc.end?.cfi
    if (target && onPage(target)) targetSeen = true
    else if (targetSeen) {
      target = undefined
      targetSeen = false
    }
    clearTimeout(timer)
    timer = setTimeout(publish, LOCATION_DEBOUNCE_MS)
  }
  const selected = (cfiRange: string, contents: BridgeContents) => {
    try {
      const range = contents.range(cfiRange)
      const text = range.toString().trim()
      if (!text) return
      const blockIds = o
        .blocks()
        .filter((b) => {
          if (new EpubCFI(b.cfiRange).spinePos !== contents.sectionIndex)
            return false
          try {
            const r = contents.range(b.cfiRange)
            return (
              range.compareBoundaryPoints(1, r) > 0 &&
              range.compareBoundaryPoints(3, r) < 0
            )
          } catch {
            return false
          }
        })
        .map((b) => b.blockId)
      for (const cb of selections) cb({ cfiRange, text, blockIds })
    } catch {
      /* Removed views have no selectable range. */
    }
  }
  const observer = new MutationObserver(() => {
    for (const cb of themes) cb(theme())
  })
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['class', 'style'],
  })
  const themeStyle = document.getElementById('theme')
  if (themeStyle)
    observer.observe(themeStyle, {
      subtree: true,
      childList: true,
      characterData: true,
    })
  o.rendition.on('relocated', relocated)
  o.rendition.on('selected', selected)
  o.rendition.on('illus:navigate', navigate)
  const refreshLocation = () => {
    last = undefined
    Promise.resolve(o.rendition.currentLocation()).then((loc) =>
      relocated(loc as { start?: { cfi?: string }; end?: { cfi?: string } }),
    )
  }
  const clearHighlights = (kind?: 'evidence' | 'step') => {
    for (const [cfi, ownKind] of highlights)
      if (!kind || ownKind === kind) {
        o.rendition.annotations.remove(cfi, 'highlight')
        highlights.delete(cfi)
      }
  }
  return {
    onLocationChange(cb) {
      locations.add(cb)
      refreshLocation()
      return () => void locations.delete(cb)
    },
    async scrollTo(cfi) {
      setTarget(cfi)
      await o.rendition.display(cfi)
    },
    highlight(cfi, kind) {
      // epub.js keys marks by CFI, so one passage holds one mark: an explicit evidence click wins over a step.
      if (kind === 'step' && highlights.get(cfi) === 'evidence')
        return { remove() {} }
      if (highlights.has(cfi)) o.rendition.annotations.remove(cfi, 'highlight')
      o.rendition.annotations.highlight(cfi, {}, undefined, `illus-${kind}`, {
        fill: theme().accent,
        'fill-opacity': kind === 'step' ? '0.3' : '0.2',
        'mix-blend-mode': 'multiply',
      })
      highlights.set(cfi, kind)
      return {
        remove() {
          if (highlights.get(cfi) === kind) {
            o.rendition.annotations.remove(cfi, 'highlight')
            highlights.delete(cfi)
          }
        },
      }
    },
    clearHighlights,
    async quoteToCfi(blockId, quote) {
      const block = o.blocks().find((b) => b.blockId === blockId)
      if (!block) return null
      const cfi = new EpubCFI(block.cfiRange)
      const contents = o.rendition
        .getContents()
        .find((c) => c.sectionIndex === cfi.spinePos)
      if (!contents) return null
      try {
        const range = quoteRange(contents.range(block.cfiRange), quote)
        return range ? contents.cfiFromRange(range) : null
      } catch {
        return null
      }
    },
    onSelection(cb) {
      selections.add(cb)
      return () => void selections.delete(cb)
    },
    getTheme: theme,
    onThemeChange(cb) {
      themes.add(cb)
      return () => void themes.delete(cb)
    },
    refreshLocation,
    setTarget,
    dispose() {
      disposed = true
      clearTimeout(timer)
      clearHighlights()
      observer.disconnect()
      o.rendition.off('relocated', relocated)
      o.rendition.off('selected', selected)
      o.rendition.off('illus:navigate', navigate)
      locations.clear()
      selections.clear()
      themes.clear()
    },
  }
}
