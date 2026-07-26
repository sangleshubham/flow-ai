# 0006 — Structural indexing: interpretation choices, browser test runner, NFKC copy

- Status: proposed
- Date: 2026-10-09
- Workstream: W1
- Spec sections: §5, §6 Phase A, §7, §14, §18, §19

(If another wave-1 ADR also took number 0006, the orchestrator may renumber this file.)

## Context

§6 Phase A leaves some cases open, the `@illus/core` v1.0 `Block` contract has no field for the NFKC match copy that §6 step 9 asks for, the "Playwright component test" for the CFI round-trip needs a bundler-backed browser runner that §19 does not name, and `@flow/epubjs` ships a `.ts` type file that `erasableSyntaxOnly` rejects.

## Decision

**Interpretations (conservative; all covered by tests in `packages/illus-book-index/test/`)**

1. **Empty headings** (`<h2></h2>`, a heading holding only an anchor) start no section. Their ids, and ids of wrapper elements (`<section id>`, `<div id>`), become link targets of the next block or heading.
2. **`<section epub:type="chapter|subchapter">`** is honoured by raising a heading's level to the nesting depth of such sections (an `h1` inside a subchapter is level 2; capped at 4). Such a section without a heading starts no section.
3. **Text before the first heading** of a spine item is its own section, titled like a heading-less spine item: TOC entry for the file, else the document `<title>`, else the href. Heading-less spine items take their TOC depth as level.
4. **TOC alignment** matches by file name plus fragment (heading id, ids inside the heading, or anchors just before it); the first heading of a file with no preamble also matches the bare file entry. A TOC label, when found, is the title. Titles keep their number ("1.2 Code"); `number` is parsed as well. Known ceiling: two spine files with the same name in different folders would collide.
5. **Captions.** A caption (`p.caption`-like class, or ≤ 12 words) matching the step 7 regex labels the code (Listing/Example) or table (Table) block immediately before or after it ("within one sibling" = adjacent). The caption stays a paragraph block (its text stays quotable); its anchors move to the labelled block so links to it reach the listing. An unattached caption keeps the label itself. `img` + following caption, and `<figure>`, become one figure block whose text is the caption. Images without caption text are skipped (no text).
6. **`blockquote` → `aside`** per the step 6 rule list; `BlockKind 'quote'` is never produced. Footnote types also include `endnote` and `rearnote`.
7. **Block text** is the text of the block's CFI range with a space between different block-level elements (list items, table cells), excluding scripts, MathML annotations and footnote back-links. Code `text` is the collapsed `code.source`.
8. **Oversized split**: parts are siblings at the same level and parent, titled "<title> (part k)" in both variants (h5/h6 or paragraphs), and keep `number`. The paragraph split makes `ceil(tokens / 3000)` balanced parts and cuts only before `paragraph` blocks (never between a caption and its listing). A single h5 part that is still oversized is not split again.
9. **Tiny merge** follows chains, so `mergedInto` always names a section that is not itself merged.
10. **Cross-references**: links to a file without a fragment target its first section; external links are ignored; code blocks are not scanned for textual references; a caption naming its own block, and a label already counted as a link in the same block, are skipped; one textual ref per label per block. `Chapter N` and `Section N` resolve through heading numbers; letters (`Appendix A`) never parse as numbers, so they stay unresolved.
11. **Re-index** (stored `indexVersion` older, or `indexStatus: 'none'`) deletes only the book's `sections`, `blocks` and `crossRefs` (phase A data), then writes one transaction per spine item. Other `books` fields (title, summary, createdAt) are kept; `indexStatus` becomes `structural`.

**NFKC match copy (contract-change request, optional)**

`Block` has no field for it and Zod strips unknown keys, so W1 exports `foldForMatch(text)` (NFKC, smart quotes → ASCII, dashes → `-`, whitespace collapsed; case kept), used by the lexical index. It is a pure function of `Block.text`, so storing it is redundant; W10's matcher needs an offset map anyway. **If a stored copy is wanted**, contracts v1.1 would add `Block.matchText?: string`; W1 would fill it in one line.

**Browser test runner (dependency request)**

The CFI round-trip runs in Vitest browser mode on Playwright Chromium (`pnpm --filter @illus/book-index e2e`), rendering every spine item with epub.js as the reader does. It needs two dev dependencies not listed by name in §19 (they are the Vitest/Playwright glue):

| Package | Pin | Published | Licence |
| --- | --- | --- | --- |
| `@vitest/browser-playwright` | 4.1.11 | 2026-08-18 | MIT |
| `playwright` | 1.63.0 | 2026-09-04 | Apache-2.0 |

W0 owns `docs/dependencies.md`; please add both rows (and note `minisearch` 7.2.0 and `jsdom` 30.1.1 are now used by `book-index`). The browser binary comes from `pnpm exec playwright install chromium`, or set `ILLUS_PW_CHANNEL=chrome` to use an installed Chrome. CI does not run `e2e` today.

**TypeScript**

`packages/illus-book-index/tsconfig.json` sets `erasableSyntaxOnly: false`, because `@flow/epubjs/types/rendition.ts` (a `.ts` file with an `enum`) is type-checked despite `skipLibCheck`. This package's own sources use no non-erasable syntax. W9 (`reader-bridge`) will hit the same error; the alternative is renaming that file to `rendition.d.ts` in `packages/epubjs` (no owner).

## Consequences

- W3 (`packContext`, lexical fallback) uses `buildLexicalIndex(blocks, sections).search(query, { beforeOrdinal })`; W10 may reuse `foldForMatch`.
- W9 uses `getSectionAt(sections, cfi)` and resolves `mergedInto` itself (§15 step 1).
- W0: add the two dev dependencies to `docs/dependencies.md`; optionally decide on `Block.matchText` and on renaming `rendition.ts`.
