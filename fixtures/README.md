# Fixtures

Test inputs for every workstream (spec §18). CI never calls a live model; everything above unit level replays these.

| Path | Owner | Contents |
| --- | --- | --- |
| `books/synthetic.epub` | W0 | Generated EPUB 3 covering the §18 edge cases (below) |
| `books/private/` | Shubham | Your own books for local evals. **Git-ignored; never commit.** |
| `scripts/make-synthetic-epub.ts` | W0 | Builds `books/synthetic.epub` (`pnpm fixtures:epub`) |
| `llm/<role>/` | the role's owner (CLAUDE.md) | Recorded or hand-written LLM responses (hand-written ones carry `"source": "handwritten"`) |
| `traces/` | W7 | Raw and compressed traces |

## Licences

| Fixture | Source | Licence | Checked |
| --- | --- | --- | --- |
| `books/synthetic.epub` | Written for this repo by `scripts/make-synthetic-epub.ts` | CC0 1.0 | 2026-10-09 |
| `@illus/core/testing` small book (`SMALL_BOOK_BLOCKS`) | Written for this repo | CC0 1.0 | 2026-10-09 |

Third-party books suggested by spec §18 are **not committed yet**; whoever adds one records it here after checking its licence:

| Candidate | Where | Licence to verify before adding |
| --- | --- | --- |
| *Pro Git* (Chacon, Straub) | git-scm.com/book | CC BY-NC-SA 3.0 per the site; confirm the EPUB build carries the same licence |
| *Eloquent JavaScript* (Haverbeke) | eloquentjavascript.net | CC BY-NC 3.0 for the text per the site; code is MIT; confirm for the EPUB edition |

Never commit fixtures (books, recorded LLM responses, traces) that contain text from a private book.

## `synthetic.epub` edge-case map

Regenerate with `pnpm fixtures:epub`; the output is byte-identical for the same script (CI checks this). The script asserts OCF basics (mimetype first and stored, every manifest item present) before writing.

| Edge case (§6 / §18) | Where |
| --- | --- |
| Spine item with **no headings** (title must come from the TOC) | `front.xhtml` ("Preface") |
| Numbered headings, `Chapter N` prefix, h1–h3 | `ch01.xhtml`, `ch02.xhtml` |
| `<section epub:type="chapter|subchapter">` | `ch02.xhtml` |
| **Tables** with a caption paragraph (`Table 1.1`) | `ch01.xhtml` §1.1 |
| Lists: `ul`, `ol`, `dl` | `ch01.xhtml` §1.1 |
| **Captioned listing** (`p.caption` "Listing 1.1" before `pre.programlisting > code.language-python`) | `ch01.xhtml` §1.2 |
| Other code markers: `div.listing[data-type=programlisting]`, `pre.brush: go`, `code.lang-shell` (shell command, no behaviour) | `ch01.xhtml` §1.2 |
| Asides: `aside.note`, `blockquote`, `div.warning` | `ch01.xhtml` §1.2 |
| **Footnote** (`epub:type="noteref"` → `aside epub:type="footnote"` with a back-link) | `ch01.xhtml` §1.2 |
| Soft hyphen (U+00AD), ligatures (U+FB01, U+FB02), smart quotes | `ch01.xhtml` intro paragraph |
| **MathML with a TeX annotation** (block) and inline MathML without one | `ch02.xhtml` §2.1 |
| Figures: `figure > img + figcaption` (Figure 2.1) and `img` + following `p.caption` (Figure 2.2) | `ch02.xhtml` §2.2 |
| **Internal links**: cross-file to a listing and a table, same-file to a section | `ch02.xhtml` intro and §2.2 |
| **Textual cross-references**: Chapter 1, Section 1.2, Listing 1.1, Table 1.1, Figure 2.1, and the unresolvable Figure 9.9 | `ch02.xhtml` |
| Back-reference phrase for the lexical fallback ("As we saw") | `ch02.xhtml` intro |
| **Empty headings**: `<h2></h2>` and an `h2` holding only an anchor | `ch02.xhtml` after §2.2 |
| **Tiny section** (heading straight into a subheading → `mergedInto`) | `ch02.xhtml` §2.3 / §2.3.1 |
| **Oversized section** without subheadings (~26,000 chars, > 6,000 tokens → paragraph split) | `ch03.xhtml` §3.1 |
| Oversized section split by `h5` headings | `ch03.xhtml` §3.2 |
| **Scripted content** (manifest `properties="scripted"`; must never run, §17) | `ch04.xhtml` |
| Linked stylesheet and an image resource (epub.js turns them into `blob:` URLs; CSP check) | `style.css`, `images/pixel.png` |
| EPUB 3 nav document plus an EPUB 2 NCX | `nav.xhtml`, `toc.ncx` |
