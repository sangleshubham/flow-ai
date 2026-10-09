# 0006 — Grounding, structural validation and eval harness choices (W10 phase A)

- Status: proposed
- Date: 2026-10-09
- Workstream: W10
- Spec sections: §8 stage 3, §9 (effort sweep), §16, §18

## Context

§16 and §18 leave details open that the code has to fix: how far normalisation goes, what "label" and "sentence" mean for the relevance check, how the grounding score treats cascaded drops, which rule violations are auto-fixed, what to do with ungrounded template elements, and how evals run before the pipeline exists. Where the spec was unclear, the conservative option was taken.

## Decision

**Grounding (`@illus/core/grounding`)**

1. `normalizeText` applies NFKC per grapheme cluster (base + combining marks), lowercases, unifies quotes (‘ ’ ‚ ‛ ′ → `'`, “ ” „ ‟ ″ « » → `"`) and dashes (U+2010–2015, U+2212, …) to `-`, removes soft hyphens **and zero-width characters** (U+200B–200D, U+2060, U+FEFF), collapses whitespace and trims. It keeps an original range per output character. It is exported (with `findQuote`) for W9's `quoteToCfi`.
2. Search order: exact in the cited block → exact in another permitted block (first in map order; `blockId` corrected) → fuzzy over **all** permitted blocks, keeping the best window. Fuzzy windows are runs of `n-1 … n+1` whitespace-delimited words (so trailing punctuation may be included in `start`/`end`).
3. Relevance: sentences split after `.`/`!`/`?` before whitespace and at newlines (code lines count as sentences), on the original block text. Label and alias terms are lowercased, stopwords removed, crudely de-pluralised (`entries` = `entry`). A label with no content words passes. Labels used: node/state/class/entity/series label; edges, messages, transitions and relations use their label plus both endpoint labels; math terms use symbol + meaning; template elements have no label and always pass. Aliases: `ctx.aliases` entry whose canonical name or alias equals the label (case-insensitive).

**Validation (`@illus/core/validate`)**

4. `counts.total` counts every evidence-bearing element the model produced. Elements dropped because a neighbour failed (dangling) lower the score; `groundingScore` is 0 when total is 0 (html).
5. A dropped element is a `warning` with `autoFixed` (`quote-not-found`, `dangling`), not an error: `report.ok` reflects remaining errors only. The re-extract decision (> 30% dropped, or `too-few-elements`) is `needsReextract(report)`.
6. Unknown endpoints (edges, messages, transitions, relations) are **errors**, not drops, so `repair` can fix a mistyped id. Edge endpoints must be nodes, not groups.
7. Errors: duplicate ids (nodes and groups share a namespace), duplicate node labels, more than 2 isolated nodes, cyclic group nesting, missing initial state, blank events, `logY` with a non-positive domain, duplicate series names, a math `sourceBlockId` outside the permitted blocks (not in §16; the formula must come from the book), unknown lanes and message targets, equal `at` within a lane, and too few elements (graph < 2 nodes, sequence < 1 message, state < 2 states or no transition, chart/math/timeline/class/ER empty). Warnings: unreachable states, math source block not of kind `math`, no template registry, html has no evidence.
8. Safe auto-fixes (remove or reorder only): membership of a missing group is cleared, unused sequence participants are removed, unknown `final` states are removed, timeline events are sorted by `at`. Self-loops need evidence: L2 already drops any edge whose evidence fails.
9. Ungrounded **template** elements cannot be removed generically (their shape is template-specific): the evidence entry is removed and a `template-element-ungrounded` **error** keeps the report failing, so the pipeline re-extracts or repairs instead of showing ungrounded data.
10. Hooks: template props and invariants run through `ctx.templates` (W5's `TemplateSpec`); animation (W6) and render (L4) issues merge with `addIssues(report, issues)`.

**Evals (`evals/`)**

11. A run is a `CaseRun` (planner and extractor attempts as raw model output, context blocks, calls, latency path). Replay reads `evals/replay/<caseId>.json`; the harness itself parses, validates and grounds, so schema and grounding metrics come from real code. The live runner is injected in phase B.
12. `bookRef` adds `small-book` (`@illus/core/testing`) and `eval-mini` (CC0 sections in `evals/src/books/eval-mini.ts`) to the open-licensed fixtures, so data-structure and code cases exist before more EPUBs are added.
13. Reports embed their data as JSON in an HTML comment for the next diff; sweep reports are `<date>-sweep.md`. In replay, a sweep replays the base recording unless `<id>@<role>@<effort>.json` exists, and the report says so.
14. Root `package.json` `eval` now runs `pnpm --filter @illus/evals eval` (outside W10's ownership; one line). Replay is the default; `--live` exits with an error until phase B.

## Contract-change request

`TemplateSpec` gains an optional `dropElement?(props, path): props` so `validate()` can remove an ungrounded template element the way it does for other kinds (decision 9 would then become a drop). Additive and optional, so no existing implementer breaks. Owner of the change: W0 (amend contracts); implementer: W5.

## Consequences

- W3 calls `validate()` then `needsReextract()`; on `!report.ok` runs `repair` once (§16 L3).
- W9 can use `findQuote(blockText, quote)` for `quoteToCfi` and gets the same match as grounding.
- `docs/contracts.md` is regenerated with the new exports; parallel workstreams filling `@illus/core` will conflict there and should regenerate it on merge.
- Synthetic `sectionId`s in golden cases are provisional until W1 lands; a phase B test will check them against the real index.
