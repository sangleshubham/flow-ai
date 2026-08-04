// Text rules of §6 Phase A: normalisation (step 9), token estimates (step 10), number, label and
// cross-reference patterns (steps 5, 7, 13). Pure and DOM-free.

/** Bump when the structural output for the same EPUB changes; books indexed with an older version are re-indexed (§6 step 1). */
export const INDEX_VERSION = 2

/** Block text: NFC, soft hyphens (U+00AD) removed, whitespace collapsed and trimmed (§6 step 9). */
export function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/­/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * `Block.text` of a code block (contracts v1.2): NFC, soft hyphens removed, CRLF → LF, trailing whitespace
 * on each line and blank lines at the start and end trimmed. Line breaks and indentation (tabs too) are kept.
 */
export function normalizeCodeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\u00AD/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+$/gm, '')
    .replace(/^\n+/, '')
    .trimEnd()
}

/**
 * Match copy of block text, used only for matching (lexical search, grounding): NFKC (folds ligatures such
 * as U+FB01 → "fi"), smart quotes → ASCII quotes, dashes → '-', then `normalizeText`. Case is kept.
 */
export function foldForMatch(text: string): string {
  return normalizeText(
    text
      .normalize('NFKC')
      .replace(/[‘’‚‛′‵]/g, "'")
      .replace(/[“”„‟″‶]/g, '"')
      .replace(/[‐-―−]/g, '-'),
  )
}

/** `ceil(chars / 3)` for code, `ceil(chars / 3.6)` for prose (§6 step 10). */
export function estimateTokens(text: string, isCode: boolean): number {
  return Math.ceil(text.length / (isCode ? 3 : 3.6))
}

/** §6 step 5: heading numbers, e.g. "Chapter 5 Consensus" → "5", "5.3.2 Log Matching" → "5.3.2". */
export const HEADING_NUMBER = /^(Chapter\s+)?(\d+(\.\d+)*)\s+/

export function parseHeadingNumber(title: string): string | undefined {
  return HEADING_NUMBER.exec(title)?.[2]
}

/** §6 step 7: caption labels, e.g. "Listing 4.2 Binary search" → "Listing 4.2". */
export const CAPTION_LABEL = /^(Figure|Fig\.|Listing|Example|Table)\s+([A-Z]?\d+(\.\d+)*)/

export interface Label {
  /** As written in the book: 'Fig. 3.1'. */
  label: string
  /** Lookup key with 'Fig.' folded into 'Figure': 'Figure 3.1'. */
  key: string
  kind: string
}

const labelKey = (kind: string, num: string) => `${kind === 'Fig.' ? 'Figure' : kind} ${num}`

export function parseCaptionLabel(text: string): Label | undefined {
  const m = CAPTION_LABEL.exec(text)
  return m ? { label: `${m[1]} ${m[2]}`, key: labelKey(m[1]!, m[2]!), kind: labelKey(m[1]!, '').trim() } : undefined
}

/** §6 step 13: textual cross-references. */
export const TEXTUAL_REF = /\b(Figure|Fig\.|Listing|Table|Example|Section|Chapter|Appendix)\s+([A-Z]?\d+(\.\d+)*)/g

export interface TextualRef extends Label {
  /** 'number' refs (Section/Chapter/Appendix) resolve through section numbers, 'label' refs through block labels. */
  by: 'number' | 'label'
  num: string
}

export function findTextualRefs(text: string): TextualRef[] {
  return [...text.matchAll(TEXTUAL_REF)].map((m) => {
    const kind = m[1]!
    const num = m[2]!
    const by = kind === 'Section' || kind === 'Chapter' || kind === 'Appendix' ? 'number' : 'label'
    return { label: `${kind} ${num}`, key: labelKey(kind, num), kind: labelKey(kind, '').trim(), by, num }
  })
}
