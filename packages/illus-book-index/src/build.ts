// From walked spine items to the stored structure (§6 Phase A steps 4, 5, 10–13): TOC titles, numbers,
// oversized-section splits, tiny-section merges, ids, ordinals, the section tree and cross-references.
// DOM-free.
import { makeBlockId, makeSectionId, sectionContentHash, type Block, type CrossRef, type SectionNode } from '@illus/core'

import { estimateTokens, findTextualRefs, parseHeadingNumber } from './text.ts'
import type { RawBlock, RawSection } from './walk.ts'

/** Sections over this many tokens are split (§6 step 11). */
export const OVERSIZED_TOKENS = 6000
/** Target size of the paragraph-boundary parts of an oversized section. */
export const PART_TOKENS = 3000
/** Sections under this many tokens with children are generated with their first child (§6 step 12). */
export const TINY_TOKENS = 80

/** epub.js `NavItem`, the parts used here. */
export interface TocItem {
  href: string
  label: string
  subitems?: TocItem[]
}

export interface SpineInput {
  spineIndex: number
  /** Spine item href as epub.js gives it (relative to the package document). */
  spineHref: string
  docTitle: string
  sections: RawSection[]
}

export interface BookStructure {
  sections: SectionNode[]
  blocks: Block[]
  crossRefs: CrossRef[]
}

/**
 * Lookup key for an href: last path segment plus fragment, both URI-decoded.
 * ponytail: matches TOC and link targets by file name, so two spine files with the same name in different
 * folders would collide; resolve full paths against the OPF if a real book ever does that.
 */
function hrefKey(href: string, base = ''): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null // external: http:, mailto:, …
  let url: URL
  try {
    url = new URL(href, `https://book.invalid/${base}`)
  } catch {
    return null
  }
  const file = decodeURIComponent(url.pathname.split('/').pop() ?? '')
  const frag = url.hash ? decodeURIComponent(url.hash.slice(1)) : ''
  return frag ? `${file}#${frag}` : file
}

interface TocEntry {
  label: string
  depth: number
}

function tocIndex(items: readonly TocItem[]): Map<string, TocEntry> {
  const map = new Map<string, TocEntry>()
  const visit = (list: readonly TocItem[], depth: number) => {
    for (const item of list) {
      const key = hrefKey(item.href)
      const label = item.label.replace(/\s+/g, ' ').trim()
      if (key && label && !map.has(key)) map.set(key, { label, depth })
      visit(item.subitems ?? [], depth + 1)
    }
  }
  visit(items, 1)
  return map
}

/** A section after titles and splits, before ids. */
interface Flat {
  spineIndex: number
  spineHref: string
  level: 1 | 2 | 3 | 4
  title: string
  number?: string
  anchors: string[]
  cfiStart: string
  cfiEnd: string
  blocks: RawBlock[]
}

const tokensOf = (blocks: readonly RawBlock[]) =>
  blocks.reduce((sum, b) => sum + estimateTokens(b.text, b.kind === 'code'), 0)

const asLevel = (n: number) => Math.min(4, Math.max(1, n)) as 1 | 2 | 3 | 4

/** §6 step 11: split at h5/h6 when present, else into ~equal parts of about PART_TOKENS at paragraphs. */
export function splitBlocks(blocks: readonly RawBlock[]): RawBlock[][] {
  const total = tokensOf(blocks)
  if (total <= OVERSIZED_TOKENS) return [[...blocks]]
  const parts: RawBlock[][] = [[]]
  if (blocks.some((b) => b.splitBefore)) {
    for (const b of blocks) {
      if (b.splitBefore && parts.at(-1)!.length) parts.push([])
      parts.at(-1)!.push(b)
    }
    return parts
  }
  const count = Math.ceil(total / PART_TOKENS)
  const target = total / count
  let acc = 0
  for (const b of blocks) {
    const t = estimateTokens(b.text, b.kind === 'code')
    if (b.kind === 'paragraph' && acc > 0 && acc + t > target && parts.length < count) {
      parts.push([])
      acc = 0
    }
    parts.at(-1)!.push(b)
    acc += t
  }
  return parts
}

function flatten(spines: readonly SpineInput[], toc: Map<string, TocEntry>): Flat[] {
  const out: Flat[] = []
  for (const spine of spines) {
    const file = hrefKey(spine.spineHref) ?? spine.spineHref
    const bare = toc.get(file)
    const hasPreamble = spine.sections[0]?.kind === 'spine'
    spine.sections.forEach((raw, k) => {
      let title: string
      let level: 1 | 2 | 3 | 4
      if (raw.kind === 'spine') {
        // §6 step 4: a spine item (or preamble) without a heading is titled from its TOC entry.
        title = bare?.label ?? (spine.docTitle || spine.spineHref)
        level = asLevel(bare?.depth ?? 1)
      } else {
        // §6 step 5: align with the TOC (href + fragment) to recover clean titles.
        const byAnchor = raw.anchors.map((id) => toc.get(`${file}#${id}`)).find(Boolean)
        const byFile = k === 0 && !hasPreamble ? bare : undefined
        title = (byAnchor ?? byFile)?.label ?? raw.headingText
        level = asLevel(raw.level)
      }
      const number = parseHeadingNumber(title) ?? parseHeadingNumber(raw.headingText)
      const base = { spineIndex: spine.spineIndex, spineHref: spine.spineHref, level, ...(number && { number }) }
      const parts = splitBlocks(raw.blocks)
      parts.forEach((blocks, p) => {
        // The first part keeps the heading's title (it holds the heading and its anchors); later parts are
        // titled by the h5/h6 they start with, or "(part k)" after a paragraph-boundary split (ADR 0025).
        const byHeading = raw.blocks.some((b) => b.splitBefore)
        out.push({
          ...base,
          title: parts.length === 1 || (byHeading && p === 0) ? title : byHeading ? blocks[0]!.text : `${title} (part ${p + 1})`,
          anchors: p === 0 ? raw.anchors : [],
          cfiStart: p === 0 ? raw.cfiStart : blocks[0]!.cfiStart,
          cfiEnd: blocks.at(-1)?.cfiEnd ?? raw.cfiEnd,
          blocks,
        })
      })
    })
  }
  return out
}

/** Builds sections, blocks and cross-references for a whole book from its walked spine items. */
export async function buildStructure(bookId: string, spines: readonly SpineInput[], tocItems: readonly TocItem[]): Promise<BookStructure> {
  const flat = flatten(spines, tocIndex(tocItems))
  const sections: SectionNode[] = []
  const blocks: Block[] = []
  const raws: RawBlock[] = []
  const stack: SectionNode[] = []
  const inSpine = new Map<number, number>()

  for (const [ordinal, f] of flat.entries()) {
    while (stack.length && stack.at(-1)!.level >= f.level) stack.pop()
    const parent = stack.at(-1)
    const headingPath = [...(parent?.headingPath ?? []), f.title]
    const ordinalInSpine = inSpine.get(f.spineIndex) ?? 0
    inSpine.set(f.spineIndex, ordinalInSpine + 1)
    const sectionId = makeSectionId({ bookId, spineIndex: f.spineIndex, headingPath, ordinalInSpine })
    const own = f.blocks.map((raw, n): Block => {
      const { kind, text, label, code, figure, table, math, cfiRange } = raw
      return {
        blockId: makeBlockId(sectionId, n),
        sectionId,
        kind,
        text,
        ...(label && { label }),
        ...(code && { code }),
        ...(figure && { figure }),
        ...(table && { table }),
        ...(math && { math }),
        cfiRange,
      }
    })
    const section: SectionNode = {
      sectionId,
      bookId,
      spineIndex: f.spineIndex,
      spineHref: f.spineHref,
      ordinal,
      level: f.level,
      ...(f.number && { number: f.number }),
      title: f.title,
      headingPath,
      ...(parent && { parentId: parent.sectionId }),
      childIds: [],
      blockIds: own.map((b) => b.blockId),
      cfiStart: f.cfiStart,
      cfiEnd: f.cfiEnd,
      contentHash: await sectionContentHash(own.map((b) => b.text)),
      tokenEstimate: tokensOf(f.blocks),
    }
    parent?.childIds.push(sectionId)
    stack.push(section)
    sections.push(section)
    blocks.push(...own)
    raws.push(...f.blocks)
  }

  const byId = new Map(sections.map((s) => [s.sectionId, s]))
  // §6 step 12: tiny sections are generated with their first child; chains resolve to the final target.
  for (const s of [...sections].reverse()) {
    if (s.tokenEstimate >= TINY_TOKENS || !s.childIds.length) continue
    const child = byId.get(s.childIds[0]!)!
    s.mergedInto = child.mergedInto ?? child.sectionId
  }

  return { sections, blocks, crossRefs: crossRefs(flat, sections, blocks, raws) }
}

/** §6 step 13: links by spine href + fragment, textual references by label and section number. */
function crossRefs(flat: readonly Flat[], sections: readonly SectionNode[], blocks: readonly Block[], raws: readonly RawBlock[]): CrossRef[] {
  const byId = new Map<string, { targetSectionId: string; targetBlockId?: string }>()
  const firstInFile = new Map<string, string>()
  const byNumber = new Map<string, string>()
  const byLabel = new Map<string, Block>()
  flat.forEach((f, i) => {
    const s = sections[i]!
    const file = hrefKey(f.spineHref) ?? f.spineHref
    if (!firstInFile.has(file)) firstInFile.set(file, s.sectionId)
    for (const id of f.anchors) if (!byId.has(`${file}#${id}`)) byId.set(`${file}#${id}`, { targetSectionId: s.sectionId })
    if (s.number && !byNumber.has(s.number)) byNumber.set(s.number, s.sectionId)
  })
  const spineOf = new Map(sections.map((s) => [s.sectionId, s.spineHref]))
  blocks.forEach((b, i) => {
    const file = hrefKey(spineOf.get(b.sectionId)!)!
    for (const id of raws[i]!.anchors)
      if (!byId.has(`${file}#${id}`)) byId.set(`${file}#${id}`, { targetSectionId: b.sectionId, targetBlockId: b.blockId })
    const key = b.label && findTextualRefs(b.label)[0]?.key
    if (key && !byLabel.has(key)) byLabel.set(key, b)
  })

  const refs: CrossRef[] = []
  blocks.forEach((b, i) => {
    const raw = raws[i]!
    const linkLabels = new Set<string>()
    for (const link of raw.links) {
      const key = hrefKey(link.href, spineOf.get(b.sectionId))
      if (key === null) continue
      const target = key.includes('#') ? byId.get(key) : firstInFile.has(key) ? { targetSectionId: firstInFile.get(key)! } : undefined
      if (link.text) linkLabels.add(link.text)
      refs.push({ fromBlockId: b.blockId, kind: 'link', ...(link.text && { label: link.text }), ...target, resolved: !!target })
    }
    if (b.kind === 'code') return
    const seen = new Set<string>()
    for (const ref of findTextualRefs(b.text)) {
      if (seen.has(ref.key) || linkLabels.has(ref.label) || ref.key === raw.captionOf) continue
      seen.add(ref.key)
      const target =
        ref.by === 'number'
          ? byNumber.has(ref.num)
            ? { targetSectionId: byNumber.get(ref.num)! }
            : undefined
          : byLabel.has(ref.key)
            ? { targetSectionId: byLabel.get(ref.key)!.sectionId, targetBlockId: byLabel.get(ref.key)!.blockId }
            : undefined
      if (target?.targetBlockId === b.blockId) continue // a caption naming its own figure
      refs.push({ fromBlockId: b.blockId, kind: 'textual', label: ref.label, ...target, resolved: !!target })
    }
  })
  return refs
}
