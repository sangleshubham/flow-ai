import { findQuote } from '@illus/core'

const SKIP = 'script,style,nav,head,template,noscript,annotation,annotation-xml,[epub\\:type="backlink"]'
const BLOCKS = 'p,li,td,th,div,pre,blockquote,aside,figcaption,caption,h1,h2,h3,h4,h5,h6'
interface Offset { node: Text; offset: number }

/** Grounding's normalization/offset map over included DOM text, bounded by one indexed block. */
export function quoteRange(blockRange: Range, quote: string): Range | null {
  const root = blockRange.commonAncestorContainer
  const doc = root.ownerDocument!
  const walker = doc.createTreeWalker(root, 5)
  const offsets: Offset[] = []
  let text = ''
  let previous: Element | null | undefined
  let pendingBreak = false
  for (let node: Node | null = root.nodeType === 3 ? root : walker.nextNode(); node; node = walker.nextNode()) {
    if (!blockRange.intersectsNode(node) || node.parentElement?.closest(SKIP)) continue
    if (node.nodeType === 1) {
      if ((node as Element).localName === 'br') pendingBreak = true
      continue
    }
    const part = node as Text
    const start = node === blockRange.startContainer ? blockRange.startOffset : 0
    const end = node === blockRange.endContainer ? blockRange.endOffset : part.length
    const parent = part.parentElement?.closest(BLOCKS) ?? null
    if (text && (pendingBreak || (previous !== undefined && previous !== parent))) {
      text += ' '
      offsets.push({ node: part, offset: start })
    }
    pendingBreak = false
    previous = parent
    for (let i = start; i < end; i++) {
      text += part.data[i]
      offsets.push({ node: part, offset: i })
    }
  }
  const match = findQuote(text, quote)
  const from = match && offsets[match.start]
  const last = match && offsets[match.end - 1]
  if (!from || !last) return null
  const range = doc.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(last.node, last.offset + 1)
  return range
}
