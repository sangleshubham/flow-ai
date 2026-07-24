import { z } from 'zod'

import { maxWords, Sha256Hex, Timestamp } from './common.ts'

/** Typed piece of a section (§5, classification rules in §6 step 6). */
export const BlockKind = z.enum(['paragraph', 'code', 'figure', 'table', 'math', 'list', 'aside', 'quote'])
export type BlockKind = z.infer<typeof BlockKind>

/** One block of book text. `text` is normalised plain text (NFC, whitespace collapsed, §6 step 9). */
export const Block = z
  .object({
    blockId: z.string().min(1),
    sectionId: z.string().min(1),
    kind: BlockKind,
    text: z.string(),
    /** 'Listing 4.2', 'Figure 3.1', 'Table 2.4' */
    label: z.string().min(1).optional(),
    code: z.object({ source: z.string(), langHint: z.string().min(1).optional() }).optional(),
    figure: z
      .object({
        caption: z.string().optional(),
        alt: z.string().optional(),
        imgHref: z.string().optional(),
      })
      .optional(),
    table: z.object({ html: z.string(), rows: z.array(z.array(z.string())) }).optional(),
    math: z.object({ mathml: z.string().optional(), tex: z.string().optional() }).optional(),
    /** epub.js CFI range used for highlighting. */
    cfiRange: z.string().min(1),
  })
  .refine((b) => b.kind !== 'code' || b.code !== undefined, {
    message: 'code blocks must carry `code`',
    path: ['code'],
  })
export type Block = z.infer<typeof Block>

/** Heading level that starts a section (h1–h4, §6 step 4). */
export const SectionLevel = z.literal([1, 2, 3, 4])
export type SectionLevel = z.infer<typeof SectionLevel>

/** A heading-delimited unit inside a spine item; the unit of generation (§5). */
export const SectionNode = z.object({
  sectionId: z.string().min(1),
  bookId: z.string().min(1),
  spineIndex: z.number().int().nonnegative(),
  spineHref: z.string().min(1),
  /** Global reading-order integer across the book. */
  ordinal: z.number().int().nonnegative(),
  level: SectionLevel,
  /** '5.3.2' when the heading carries a number. */
  number: z.string().min(1).optional(),
  title: z.string(),
  headingPath: z.array(z.string()),
  parentId: z.string().min(1).optional(),
  childIds: z.array(z.string().min(1)),
  blockIds: z.array(z.string().min(1)),
  cfiStart: z.string().min(1),
  cfiEnd: z.string().min(1),
  contentHash: Sha256Hex,
  tokenEstimate: z.number().int().nonnegative(),
  /** Set on tiny sections (< 80 tokens) generated together with their first child (§6 step 12, §15 step 1). */
  mergedInto: z.string().min(1).optional(),
})
export type SectionNode = z.infer<typeof SectionNode>

/** A link or textual reference from a block to a section or block (§5, §6 step 13). */
export const CrossRef = z.object({
  /** Auto-increment key of the `crossRefs` store; absent until stored. */
  id: z.number().int().positive().optional(),
  fromBlockId: z.string().min(1),
  kind: z.enum(['link', 'textual']),
  label: z.string().min(1).optional(),
  targetSectionId: z.string().min(1).optional(),
  targetBlockId: z.string().min(1).optional(),
  /** Unresolved references are stored with `resolved: false` and never guessed. */
  resolved: z.boolean(),
})
export type CrossRef = z.infer<typeof CrossRef>

/** Indexing progress of a book (§6): `structural` after phase A, `complete` after phase B. */
export const IndexStatus = z.enum(['none', 'structural', 'complete'])
export type IndexStatus = z.infer<typeof IndexStatus>

/** 150-word book summary plus naming conventions, the cached prompt prefix (§6 phase B step 6). */
export const BookSummary = z.object({
  summary: maxWords(150),
  conventions: z.array(z.string().min(1)),
})
export type BookSummary = z.infer<typeof BookSummary>

/** Record of the `books` store (§5). `bookId` = first 16 hex of SHA-256 of the EPUB bytes. */
export const BookMeta = z.object({
  bookId: z.string().regex(/^[0-9a-f]{16}$/, 'bookId is 16 lowercase hex characters'),
  title: z.string(),
  indexStatus: IndexStatus,
  /** `INDEX_VERSION` of `@illus/book-index` that produced the structural index. */
  indexVersion: z.number().int().nonnegative(),
  sectionCount: z.number().int().nonnegative().optional(),
  summary: BookSummary.optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type BookMeta = z.infer<typeof BookMeta>
