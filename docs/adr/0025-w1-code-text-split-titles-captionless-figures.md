# 0025 — Indexer: code text layout, split-part titles, caption-less figures (INDEX_VERSION 2)

- Status: accepted (Shubham, 2026-10-09)
- Date: 2026-10-09
- Workstream: W1
- Spec sections: §5, §6 Phase A steps 6, 9, 11, §14

## Context

Shubham decided after wave 1 that `code` blocks keep their layout (contracts v1.2, [ADR 0008](0008-contracts-v1-1.md)), that split-part titles come from the sub-heading instead of "(part k)", and that caption-less images become figure blocks. These amend decisions 5, 7 and 8 of [ADR 0006-w1](0006-w1-structural-indexing-decisions.md). The interpretation details below were left open.

## Decision

1. **Code text.** `Block.text` of a `code` block is `normalizeCodeText(raw)`. It applies NFC, removes soft hyphens and turns CRLF into LF. It trims trailing whitespace on each line and blank lines at the start and end. Line breaks and indentation (tabs included) are kept. `<br>` and block-level line elements (e.g. `<p>` per line inside `div.programlisting`) become `\n`. A code range starts at its first text node even when that node is blank, so first-line indentation held in a separate node is kept. `code.source` is now the same string as `text`. Outside code, `<br>` now separates words (it used to glue them together).
2. **Split-part titles.** When an oversized section splits at h5/h6, the first part keeps the heading's (TOC) title, because it holds the heading, its anchors and the TOC target. Each later part takes the text of the h5/h6 it starts with. Paragraph-boundary splits have no sub-heading, so they keep `"<title> (part k)"`. All parts keep the section's `number` (they are still inside that numbered section). `headingPath` ends in the part title, so section ids of h5 parts change.
3. **Caption-less images.** An element with no text that contains an `img`, `image` or `svg` becomes a `figure` block. This covers a bare `img`, `<p><img/></p>`, `<div><img/></div>` and `<figure>` without a `figcaption`. The block has `text: ''` and `figure: { alt?, imgHref? }`, with no label. Alt text is not put into `text`, because `text` must equal the CFI range text for grounding and highlighting. epub.js CFIs only end on text nodes (`pathTo` forces a text step when given an offset), so a range around an element cannot be expressed. Its `cfiRange` (and the internal start and end) is therefore the image element's node CFI, which has no comma. `toRange` on it gives a collapsed range at the image. An image inside a paragraph with text stays part of that paragraph. An image-only element followed by a caption is still one captioned figure.
4. **`INDEX_VERSION` 1 → 2**, so books indexed by v1 re-index on next open.
5. **TypeScript.** The `erasableSyntaxOnly: false` override in `packages/illus-book-index/tsconfig.json` is removed now that `@flow/epubjs` ships `rendition.d.ts`.

## Consequences

- W9: a figure block's `cfiRange` may be a node CFI, not a range. `display(cfi)` works; a highlight of it is empty. `blockTextOfRange(range, kind)` takes the block kind, so code ranges compare correctly.
- W3/W7: code text is ready to execute or translate. The lexical index still folds whitespace (`foldForMatch`).
- W0 (contract-change request): `fixtures/scripts/test/eval-mini.test.ts` must compare against `EVAL_MINI_SECTIONS` directly (remove the collapse workaround). It fails against INDEX_VERSION 2 until then. Please also add a caption-less image to `synthetic.epub`, so the browser CFI test covers rule 3 in a real rendition (today only jsdom covers it).

## Decision (Shubham, 2026-10-09)

Accepted as built: the first part after an h5/h6 split keeps the TOC title, and caption-less figures keep their alt text only in `figure.alt` (`text` stays empty). `synthetic.epub` ends §2.2 with a caption-less image (block `…2-2-figures:2#b6`, [ADR 0042](0042-w0-post-wave3-port.md)); W1, W3 and W10 re-key their fixtures afterwards.
