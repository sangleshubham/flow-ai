// DOM walk of one spine item (§6 Phase A steps 3, 4, 6, 7, 8, 9): headings start sections, block rules
// classify content, every block gets a CFI range. Output is plain data; everything after this is DOM-free.
import { EpubCFI } from '@flow/epubjs'
import type { Block, BlockKind } from '@illus/core'

import { normalizeText, parseCaptionLabel, type Label } from './text.ts'

const OPS_NS = 'http://www.idpf.org/2007/ops'
const TEXT_NODE = 3
const ELEMENT_NODE = 1

/** Never blocks, never part of block text. */
const SKIP = new Set(['script', 'style', 'nav', 'head', 'template', 'noscript', 'annotation', 'annotation-xml'])

/** Elements that end an inline run when walking a container, and that separate words in block text. */
const BLOCK_TAGS = new Set(
  'address article aside blockquote body caption dd details div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section summary table tbody td tfoot th thead tr ul'.split(
    ' ',
  ),
)

export interface RawLink {
  href: string
  text: string
}

/** A block before ids are assigned. `cfiStart`/`cfiEnd` are point CFIs at the ends of `cfiRange`. */
export interface RawBlock extends Omit<Block, 'blockId' | 'sectionId'> {
  cfiStart: string
  cfiEnd: string
  /** Element ids inside the block, plus anchors that preceded it (link targets). */
  anchors: string[]
  links: RawLink[]
  /** h5/h6 heading text: an oversized section may split before it (§6 step 11). */
  splitBefore?: boolean
  /** Set on a caption paragraph whose label went to the adjacent code or table block. */
  captionOf?: string
}

export interface RawSection {
  /** `heading`: started by h1–h4. `spine`: content without a heading (title comes from the TOC). */
  kind: 'heading' | 'spine'
  /** Heading level (tag level, raised to the epub:type section depth); 0 for `spine` sections. */
  level: number
  headingText: string
  anchors: string[]
  cfiStart: string
  cfiEnd: string
  blocks: RawBlock[]
}

export interface WalkResult {
  docTitle: string
  sections: RawSection[]
}

const tagOf = (el: Element) => el.localName.toLowerCase()
const classes = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
const hasClass = (el: Element, ...names: string[]) => classes(el).some((c) => names.includes(c))

function epubTypes(el: Element): string[] {
  const value = el.getAttributeNS(OPS_NS, 'type') ?? el.getAttribute('epub:type') ?? ''
  return value.split(/\s+/).filter(Boolean)
}

const isFootnote = (el: Element) => epubTypes(el).some((t) => t === 'footnote' || t === 'endnote' || t === 'rearnote')

/** "Skip footnote back-links": the link from a footnote back to its reference. */
function isBackLink(el: Element): boolean {
  if (tagOf(el) !== 'a') return false
  if (epubTypes(el).includes('backlink') || el.getAttribute('role') === 'doc-backlink') return true
  let note: Element | null = el.parentElement
  while (note && !isFootnote(note)) note = note.parentElement
  if (!note) return false
  const href = el.getAttribute('href') ?? ''
  const target = href.startsWith('#') ? el.ownerDocument.getElementById(href.slice(1)) : null
  if (target) return epubTypes(target).includes('noteref')
  return /^\s*(\[?\d+\]?\.?|[↩↑^])\s*$/.test(el.textContent ?? '')
}

function isExcluded(el: Element): boolean {
  return SKIP.has(tagOf(el)) || isBackLink(el)
}

function insideExcluded(node: Node, root: Node | null): boolean {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (isExcluded(el)) return true
    if (el === root) break
  }
  return false
}

/** Text nodes under `nodes` in document order, skipping script/style/nav, MathML annotations and back-links. */
function includedTextNodes(nodes: readonly Node[]): Text[] {
  const out: Text[] = []
  const visit = (node: Node) => {
    if (node.nodeType === TEXT_NODE) out.push(node as Text)
    else if (node.nodeType === ELEMENT_NODE && !isExcluded(node as Element)) node.childNodes.forEach(visit)
  }
  nodes.forEach(visit)
  return out
}

function nearestBlock(node: Node): Element | null {
  for (let el = node.parentElement; el; el = el.parentElement) if (BLOCK_TAGS.has(tagOf(el))) return el
  return null
}

/**
 * Text covered by a range, as stored in `Block.text` (before normalisation): excluded subtrees are left out
 * and a space separates text from different block-level elements (list items, table cells). The CFI
 * round-trip test resolves a block's `cfiRange` in a rendered document and compares this to `Block.text`.
 */
export function rawTextOfRange(range: Range): string {
  const root = range.commonAncestorContainer
  const doc = root.ownerDocument ?? (root as Document)
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  const parts: string[] = []
  let prevBlock: Element | null | undefined
  for (let node: Node | null = root.nodeType === TEXT_NODE ? root : walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node) || insideExcluded(node, null)) continue
    let text = node.nodeValue ?? ''
    if (node === range.endContainer) text = text.slice(0, range.endOffset)
    if (node === range.startContainer) text = text.slice(range.startOffset)
    const block = nearestBlock(node)
    if (prevBlock !== undefined && block !== prevBlock) parts.push(' ')
    prevBlock = block
    parts.push(text)
  }
  return parts.join('')
}

/** `Block.text` of a range: `rawTextOfRange` normalised (§6 step 9). */
export function blockTextOfRange(range: Range): string {
  return normalizeText(rawTextOfRange(range))
}

function idsIn(nodes: readonly Node[]): string[] {
  const ids: string[] = []
  const visit = (node: Node) => {
    if (node.nodeType !== ELEMENT_NODE) return
    const el = node as Element
    const id = el.getAttribute('id') ?? (tagOf(el) === 'a' ? el.getAttribute('name') : null)
    if (id) ids.push(id)
    el.childNodes.forEach(visit)
  }
  nodes.forEach(visit)
  return ids
}

function linksIn(nodes: readonly Node[]): RawLink[] {
  const links: RawLink[] = []
  const visit = (node: Node) => {
    if (node.nodeType !== ELEMENT_NODE) return
    const el = node as Element
    if (isExcluded(el)) return
    const href = el.getAttribute('href')
    if (tagOf(el) === 'a' && href) links.push({ href, text: normalizeText(el.textContent ?? '') })
    el.childNodes.forEach(visit)
  }
  nodes.forEach(visit)
  return links
}

const hasText = (el: Element) => includedTextNodes([el]).some((t) => /\S/.test(t.nodeValue ?? ''))
const isImageOnly = (el: Element) => tagOf(el) === 'img' || (!hasText(el) && el.querySelector('img, image, svg') !== null)
const isCaption = (el: Element) =>
  tagOf(el) === 'figcaption' || classes(el).some((c) => c.toLowerCase().includes('caption'))

/** §6 step 6, first match wins. `null` → not a typed block (container or paragraph). */
function classify(el: Element): Exclude<BlockKind, 'paragraph' | 'quote'> | null {
  const tag = tagOf(el)
  if (tag === 'pre' || hasClass(el, 'programlisting', 'listing') || el.getAttribute('data-type') === 'programlisting')
    return 'code'
  if (tag === 'figure') return 'figure'
  if (tag === 'table') return 'table'
  if (tag === 'math') return 'math'
  if (tag === 'ul' || tag === 'ol' || tag === 'dl') return 'list'
  if (tag === 'aside' || tag === 'blockquote' || hasClass(el, 'note', 'tip', 'warning', 'sidebar') || isFootnote(el))
    return 'aside'
  return null
}

function isBlockLevel(el: Element): boolean {
  const tag = tagOf(el)
  if (tag === 'math') return el.getAttribute('display') === 'block'
  return BLOCK_TAGS.has(tag) || /^h[1-6]$/.test(tag) || classify(el) === 'code' || isFootnote(el)
}

/** Language hint from `language-*`, `lang-*`, `brush:*`, `highlight-*` classes on the block or inside it. */
function langHintOf(el: Element): string | undefined {
  for (const node of [el, ...el.querySelectorAll('pre, code')]) {
    const cls = node.getAttribute('class') ?? ''
    const m = /(?:^|\s)(?:language-|lang-|highlight-)([\w+#.-]+)/.exec(cls) ?? /(?:^|\s)brush:\s*([\w+#.-]+)/.exec(cls)
    if (m) return m[1]
  }
  return undefined
}

interface Produced {
  el: Element | null
  block: RawBlock
}

class Walker {
  readonly sections: RawSection[] = []
  private current: RawSection | null = null
  private pending: string[] = []
  private epubDepth = 0
  private readonly doc: Document
  private readonly cfiBase: string

  constructor(doc: Document, cfiBase: string) {
    this.doc = doc
    this.cfiBase = cfiBase
  }

  // section.cfiFromElement / cfiFromRange are exactly `new EpubCFI(x, section.cfiBase).toString()` (§6 step 8).
  private cfi(target: Node | Range): string {
    return new EpubCFI(target, this.cfiBase).toString()
  }

  private point(node: Text, offset: number): string {
    const range = this.doc.createRange()
    range.setStart(node, offset)
    range.collapse(true)
    return this.cfi(range)
  }

  *run(): Generator<void, RawSection[]> {
    const body = this.doc.querySelector('body') ?? this.doc.documentElement
    yield* this.container(body)
    if (this.current) this.current.anchors.push(...this.pending)
    return this.sections
  }

  private section(): RawSection {
    if (!this.current) {
      const body = this.doc.querySelector('body') ?? this.doc.documentElement
      const cfi = this.cfi(body)
      this.current = { kind: 'spine', level: 0, headingText: '', anchors: [], cfiStart: cfi, cfiEnd: cfi, blocks: [] }
      this.sections.push(this.current)
    }
    return this.current
  }

  private *container(el: Element): Generator<void, void> {
    const produced: Produced[] = []
    let run: Node[] = []
    const flush = () => {
      const block = run.length ? this.block('paragraph', run) : null
      if (block) produced.push({ el: null, block })
      run = []
    }
    for (const node of [...el.childNodes]) {
      yield
      if (node.nodeType === TEXT_NODE) {
        run.push(node)
        continue
      }
      if (node.nodeType !== ELEMENT_NODE) continue
      const child = node as Element
      if (SKIP.has(tagOf(child))) continue
      if (!isBlockLevel(child)) {
        run.push(child)
        continue
      }
      // `img` with a following caption paragraph → one figure block (§6 step 6).
      const prev = child.previousElementSibling
      if (isCaption(child) && prev && isImageOnly(prev)) {
        const at = run.indexOf(prev)
        if (at >= 0) run = run.slice(0, at)
        flush()
        const block = this.figure([prev, child], prev, child)
        if (block) produced.push({ el: child, block })
        continue
      }
      flush()
      const block = yield* this.element(child)
      if (block) produced.push({ el: child, block })
    }
    flush()
    attachCaptions(produced)
  }

  private *element(el: Element): Generator<void, RawBlock | null> {
    const tag = tagOf(el)
    const heading = /^h([1-6])$/.exec(tag)
    if (heading) {
      const n = Number(heading[1])
      if (n <= 4) {
        this.heading(el, n)
        return null
      }
      const block = this.block('paragraph', [el])
      if (block) block.splitBefore = true
      return block
    }
    const kind = classify(el)
    if (kind === 'figure') return this.figure([el], el.querySelector('img, image'), el.querySelector('figcaption'))
    if (kind) return this.typed(kind, el)
    const epubSection = tag === 'section' && epubTypes(el).some((t) => t === 'chapter' || t === 'subchapter')
    if (epubSection || [...el.children].some(isBlockLevel)) {
      const id = el.getAttribute('id')
      if (id) this.pending.push(id)
      if (epubSection) this.epubDepth++
      yield* this.container(el)
      if (epubSection) this.epubDepth--
      return null
    }
    return this.block('paragraph', [el])
  }

  private heading(el: Element, tagLevel: number) {
    const texts = includedTextNodes([el]).filter((t) => /\S/.test(t.nodeValue ?? ''))
    const ids = idsIn([el])
    const last = texts.at(-1)
    if (!last) {
      // Empty heading: not a section; its anchors point at whatever comes next.
      this.pending.push(...ids)
      return
    }
    // §6 step 4: honour <section epub:type="chapter|subchapter"> nesting (all-h1 books).
    const level = Math.min(4, Math.max(tagLevel, this.epubDepth))
    this.current = {
      kind: 'heading',
      level,
      headingText: normalizeText(texts.map((t) => t.nodeValue).join('')),
      anchors: [...this.pending, ...ids],
      cfiStart: this.cfi(el),
      cfiEnd: this.point(last, last.length),
      blocks: [],
    }
    this.pending = []
    this.sections.push(this.current)
  }

  /** Range over a block's first to last non-blank included text node; `null` when it has no text. */
  private range(nodes: readonly Node[]): { range: Range; first: Text; last: Text } | null {
    const texts = includedTextNodes(nodes).filter((t) => /\S/.test(t.nodeValue ?? ''))
    const first = texts[0]
    const last = texts.at(-1)
    if (!first || !last) return null
    const range = this.doc.createRange()
    range.setStart(first, 0)
    range.setEnd(last, last.length)
    return { range, first, last }
  }

  private block(kind: BlockKind, nodes: readonly Node[], extra: Partial<RawBlock> = {}): RawBlock | null {
    const r = this.range(nodes)
    if (!r) return null
    const text = blockTextOfRange(r.range)
    if (!text) return null
    const block: RawBlock = {
      kind,
      text,
      ...extra,
      cfiRange: this.cfi(r.range),
      cfiStart: this.point(r.first, 0),
      cfiEnd: this.point(r.last, r.last.length),
      anchors: [...this.pending, ...idsIn(nodes)],
      links: linksIn(nodes),
    }
    this.pending = []
    const section = this.section()
    section.blocks.push(block)
    section.cfiEnd = block.cfiEnd
    return block
  }

  private typed(kind: Exclude<BlockKind, 'paragraph' | 'quote' | 'figure'>, el: Element): RawBlock | null {
    if (kind === 'code') {
      const r = this.range([el])
      const source = r
        ? rawTextOfRange(r.range)
            .normalize('NFC')
            .replace(/^\s*\n/, '')
            .trimEnd()
        : ''
      const langHint = langHintOf(el)
      return this.block('code', [el], { code: langHint ? { source, langHint } : { source } })
    }
    if (kind === 'table') {
      const rows = [...el.querySelectorAll('tr')].map((tr) =>
        [...tr.children].filter((c) => /^t[dh]$/.test(tagOf(c))).map((c) => normalizeText(c.textContent ?? '')),
      )
      const caption = el.querySelector('caption')
      const label = caption ? parseCaptionLabel(normalizeText(caption.textContent ?? '')) : undefined
      return this.block('table', [el], { table: { html: el.outerHTML, rows }, ...(label && { label: label.label }) })
    }
    if (kind === 'math') {
      const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()
      return this.block('math', [el], { math: { mathml: el.outerHTML, ...(tex && { tex }) } })
    }
    return this.block(kind, [el])
  }

  private figure(nodes: readonly Element[], img: Element | null, captionEl: Element | null): RawBlock | null {
    const caption = captionEl ? normalizeText(captionEl.textContent ?? '') : undefined
    const label = caption ? parseCaptionLabel(caption) : undefined
    const imgEl = img && tagOf(img) !== 'img' ? (img.querySelector('img') ?? img) : img
    const alt = imgEl?.getAttribute('alt') ?? undefined
    const imgHref = imgEl?.getAttribute('src') ?? imgEl?.getAttribute('href') ?? imgEl?.getAttribute('xlink:href') ?? undefined
    const figure = { ...(caption && { caption }), ...(alt && { alt }), ...(imgHref && { imgHref }) }
    return this.block('figure', nodes, { figure, ...(label && { label: label.label }) })
  }
}

/**
 * §6 step 7: a caption paragraph labels the code (Listing/Example) or table (Table) block right before or
 * after it ("within one sibling"). Its anchors move to that block, so links to the caption reach the listing.
 */
function attachCaptions(produced: readonly Produced[]) {
  const captionLabel = (p: Produced | undefined): Label | undefined => {
    if (!p || p.block.kind !== 'paragraph' || p.block.captionOf) return undefined
    const label = parseCaptionLabel(p.block.text)
    if (!label) return undefined
    const looksLikeCaption = (p.el && isCaption(p.el)) || p.block.text.split(' ').length <= 12
    return looksLikeCaption ? label : undefined
  }
  const wants = (block: RawBlock, label: Label) =>
    (block.kind === 'code' && (label.kind === 'Listing' || label.kind === 'Example')) ||
    (block.kind === 'table' && label.kind === 'Table')
  produced.forEach((p, i) => {
    if (p.block.label || (p.block.kind !== 'code' && p.block.kind !== 'table')) return
    for (const j of [i - 1, i + 1]) {
      const cap = produced[j]
      const label = captionLabel(cap)
      if (!cap || !label || !wants(p.block, label)) continue
      p.block.label = label.label
      cap.block.captionOf = label.key
      p.block.anchors.push(...cap.block.anchors)
      cap.block.anchors = []
      return
    }
  })
  // A caption that labels nothing keeps its label (an orphan "Table 3.1 …" paragraph is still a target).
  for (const p of produced) {
    const label = captionLabel(p)
    if (label && p.el && isCaption(p.el)) p.block.label = label.label
  }
}

/** Walks one spine document. A generator: each `yield` is one unit of work for the idle-slice driver. */
export function walkDocument(doc: Document, cfiBase: string): Generator<void, WalkResult> {
  const walker = new Walker(doc, cfiBase)
  return (function* () {
    const sections = yield* walker.run()
    return { docTitle: normalizeText(doc.querySelector('title')?.textContent ?? ''), sections }
  })()
}
