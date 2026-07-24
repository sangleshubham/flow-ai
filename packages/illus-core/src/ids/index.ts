// Identity builders (§5 "Identity"). Ids are stable while the EPUB bytes are unchanged.
import { sha256Hex } from '../hash/index.ts'

const SLUG_MAX = 48

/** URL-safe slug of one heading: NFKD, diacritics stripped, lowercase, runs of other chars → '-'. Never empty. */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
  return slug || '_'
}

/** `headingSlugPath` of §5: slugs of the heading path joined by '/'. */
export function headingSlugPath(headingPath: readonly string[]): string {
  return headingPath.length ? headingPath.map(slugify).join('/') : '_'
}

/** `bookId` = first 16 hex chars of SHA-256 of the EPUB bytes. */
export async function makeBookId(epubBytes: Uint8Array): Promise<string> {
  return (await sha256Hex(epubBytes)).slice(0, 16)
}

export interface SectionIdParts {
  bookId: string
  spineIndex: number
  /** Heading texts from the chapter down to this section. */
  headingPath: readonly string[]
  /** 0-based position of the section within its spine item. */
  ordinalInSpine: number
}

/** `${bookId}:${spineIndex}:${headingSlugPath}:${ordinalInSpine}` (§5). */
export function makeSectionId({ bookId, spineIndex, headingPath, ordinalInSpine }: SectionIdParts): string {
  return `${bookId}:${spineIndex}:${headingSlugPath(headingPath)}:${ordinalInSpine}`
}

export interface ParsedSectionId {
  bookId: string
  spineIndex: number
  headingSlugPath: string
  ordinalInSpine: number
}

const SECTION_ID = /^([0-9a-f]{16}):(\d+):([^:#]+):(\d+)$/

export function parseSectionId(sectionId: string): ParsedSectionId | null {
  const m = SECTION_ID.exec(sectionId)
  if (!m) return null
  return { bookId: m[1]!, spineIndex: Number(m[2]), headingSlugPath: m[3]!, ordinalInSpine: Number(m[4]) }
}

/** `${sectionId}#b${n}` (§5). */
export function makeBlockId(sectionId: string, n: number): string {
  return `${sectionId}#b${n}`
}

export function parseBlockId(blockId: string): { sectionId: string; n: number } | null {
  const m = /^(.+)#b(\d+)$/.exec(blockId)
  return m ? { sectionId: m[1]!, n: Number(m[2]) } : null
}

/** `contentHash` = SHA-256 of the section's normalised block text, blocks joined by '\n' (§5). */
export async function sectionContentHash(blockTexts: readonly string[]): Promise<string> {
  return sha256Hex(blockTexts.join('\n'))
}

/** W0 convention (not in the spec): `${bookId}:c:${slug(canonical)}`. */
export function makeConceptId(bookId: string, canonical: string): string {
  return `${bookId}:c:${slugify(canonical)}`
}

/** W0 convention (not in the spec): one model per concept and kind, `${conceptId}:m:${kind}`. */
export function makeConceptModelId(conceptId: string, kind: 'graph' | 'sequence' | 'state'): string {
  return `${conceptId}:m:${kind}`
}
