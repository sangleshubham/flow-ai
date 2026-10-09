// Location → section (§14 "Location → section"): binary search over `cfiStart` with EpubCFI.compare.
import { EpubCFI } from '@flow/epubjs'
import type { SectionNode } from '@illus/core'

const cmp = new EpubCFI()

/**
 * The section containing `cfi` (e.g. a rendition's `location.start.cfi`): the last section of the cfi's
 * spine item whose `cfiStart` is at or before it, or that spine item's first section when the cfi lies
 * before every heading. `sections` are one book's sections in ordinal order (`sections.listByBook`).
 * `mergedInto` is not resolved here.
 */
export function getSectionAt(sections: readonly SectionNode[], cfi: string): SectionNode | null {
  const target = new EpubCFI(cfi)
  let lo = 0
  let hi = sections.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cmp.compare(sections[mid]!.cfiStart, target) <= 0) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  const hit = sections[found]
  if (hit?.spineIndex === target.spinePos) return hit
  return sections.find((s) => s.spineIndex === target.spinePos) ?? null
}
