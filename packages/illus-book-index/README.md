# @illus/book-index

EPUB structural indexing (spec §6 Phase A, no LLM): section tree, typed blocks, cross-references, CFI mapping, and the MiniSearch block index for the §7 lexical fallback.

- Owner: W1
- Spec: §5, §6 (Phase A), §7 (MiniSearch build), §14 (location → section)
- Decisions: [ADR 0006](../../docs/adr/0006-w1-structural-indexing-decisions.md), amended by [ADR 0025](../../docs/adr/0025-w1-code-text-split-titles-captionless-figures.md) (contracts v1.2, `INDEX_VERSION` 2)
- Depends on: `@illus/core`, `@flow/epubjs` (Flow's vendored epub.js), `minisearch`

## Public API

| Export | What it does |
| --- | --- |
| `indexBookStructure(book, repos, { bookId, scheduler?, now? })` | `AsyncGenerator<Progress>`. Walks every spine item in idle slices of ≤ 12 ms (`requestIdleCallback`, or the injected `scheduler`), builds sections, blocks and cross-refs, persists one transaction per spine item, sets `indexStatus: 'structural'` and `indexVersion`. Does nothing (one `{ phase: 'done', skipped: true }`) when the stored `indexVersion ≥ INDEX_VERSION`. |
| `INDEX_VERSION` | Currently `2`. Bump when output for the same EPUB changes; older books re-index. |
| `getSectionAt(sections, cfi)` | Section containing a CFI: binary search over `cfiStart` with `EpubCFI.compare`, restricted to the CFI's spine item. `sections` in ordinal order. Does not resolve `mergedInto`. |
| `buildLexicalIndex(blocks, sections)` | `{ search(query, { beforeOrdinal, limit = 3 }) → LexicalHit[] }` over NFKC-folded block text, only sections with `ordinal < beforeOrdinal`. |
| `normalizeText`, `normalizeCodeText`, `foldForMatch` | Block text normalisation (NFC, soft hyphens, whitespace collapsed); code block text (same, but line breaks and indentation kept, trailing whitespace per line and leading/trailing blank lines trimmed; contracts v1.2); the match copy (NFKC, quotes, dashes, whitespace collapsed). |
| `blockTextOfRange(range, kind?)` | `Block.text` of a DOM range (pass `kind: 'code'` to keep the code layout); the bridge can use it to compare a resolved CFI with a block. |
| `estimateTokens`, `parseHeadingNumber`, `parseCaptionLabel`, `findTextualRefs`, `runInSlices` | The individual §6 rules. |
| `OVERSIZED_TOKENS`, `PART_TOKENS`, `TINY_TOKENS` | 6,000 / 3,000 / 80. |

Types: `Progress`, `IndexOptions`, `IndexRepos` (`books`, `sections`, `blocks`, `crossRefs`, `transaction` of `IllusRepos`), `IdleScheduler`, `LexicalIndex`, `LexicalHit`, `LexicalSearchOptions`.

## Output notes

- `code` blocks: `text` keeps line breaks and indentation; `code.source` equals `text`. `<br>` and line elements become line breaks.
- Oversized sections split at h5/h6: the first part keeps the heading's title, each later part is titled by its h5/h6 text. Paragraph-boundary splits are titled `"<title> (part k)"`. All parts keep the section's `number`.
- Images without caption text are `figure` blocks with `text: ''` and `figure: { alt?, imgHref? }`; their `cfiRange` is the image element's node CFI (no comma range), since epub.js CFIs cannot end on an element boundary.

## Example

```ts
import { makeBookId } from '@illus/core'
import { indexBookStructure, getSectionAt, buildLexicalIndex } from '@illus/book-index'

const bookId = await makeBookId(epubBytes)
for await (const p of indexBookStructure(tab.epub, repos, { bookId })) {
  if (p.phase === 'walk') setStatus(`Indexing ${p.spineDone} / ${p.spineTotal}`)
}

const sections = await repos.sections.listByBook(bookId)
const section = getSectionAt(sections, location.start.cfi) // §14 location → section

const blocks = (await Promise.all(sections.map((s) => repos.blocks.listBySection(s.sectionId)))).flat()
const hits = buildLexicalIndex(blocks, sections).search('replicated log', { beforeOrdinal: section!.ordinal })
```

## Scripts

- `pnpm lint` · `pnpm typecheck` · `pnpm test` (jsdom: rules, structure, snapshot of every `fixtures/books/*.epub`, `INDEX_VERSION`)
- `pnpm e2e`: CFI round-trip in Chromium (Vitest browser mode + Playwright). Needs `pnpm exec playwright install chromium` once, or `ILLUS_PW_CHANNEL=chrome`.
