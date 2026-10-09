# 0008 — Contracts v1.1: wave 1 contract-change requests

- Status: accepted (Shubham's decisions after wave 1, 2026-10-09)
- Date: 2026-10-09
- Workstream: W0 (amend contracts)
- Spec sections: §4, §5, §8, §10, §16, §18, §19

## Context

Wave 1 (W1, W2, W4, W10) filed eight contract-change requests, listed in `docs/build-log.md` under "Wave 1". Shubham decided each one. This ADR records the decisions and what W0 changed. Contracts move from v1.0 to **v1.1** (minor: every change is additive or a documentation change; v1.0 producers and consumers stay valid).

## Decision

| # | Request (from) | Decision | Change |
| --- | --- | --- | --- |
| 1 | Dependency rows (W1, W2, W4) | Approved | `docs/dependencies.md`: `@vitest/browser-playwright` 4.1.11, `playwright` 1.63.0, `fake-indexeddb` 6.2.5, `vite` 8.3.1, `@types/react` 18.3.31, `@types/react-dom` 18.3.7, `@types/node` 24.13.6 (more users), React 18.0.0 as dev/peer of `@illus/render`; `minisearch` 7.2.0 and `jsdom` 30.1.1 were already listed. `vega-interpreter` 2.3.2 moved from "requested" into the runtime table (approved after wave 0). All publish dates checked against the registry: on or before the 2026-09-25 cut-off. |
| 2 | `packages/epubjs/types/rendition.ts` fails `erasableSyntaxOnly` (W1) | Approved | Renamed to `rendition.d.ts`; the `RenditionSpread` enum became the string union `'auto' \| 'none' \| 'always'` (a `.d.ts` emits no JavaScript, so a runtime enum could not stay). Flow's three users in `apps/reader` now use `import type` and string literals. W1's `erasableSyntaxOnly: false` workaround in `packages/illus-book-index/tsconfig.json` is left for W1 to revert. |
| 3 | Optional `Block.matchText` (W1) | Rejected | None. |
| 4 | Optional `TemplateSpec.dropElement?(props, path)` (W10) | Approved | Added to `TemplateSpec` in `packages/illus-core/src/schemas/ports.ts`. `path` is a `TemplateEvidence.path`; the method returns new props and must not mutate. W5 implements it per template; W10's `validate()` may then drop instead of failing (ADR 0006-w10, decision 9). |
| 5 | `@illus/llm/server` as a lint entry point (W2) | Approved | `tooling/eslint-config/index.js`: `src/server/index.ts` added to `ENTRY_POINTS`, `@illus/llm/server` allowed by `no-restricted-imports`. Tests in `tooling/eslint-config/test/boundaries.test.js`: the entry point is clean, deeper server files still fail. |
| 6 | What `VisualRecord.spec` holds (W4, ADR 0006-render) | W4's proposal approved | For IR kinds `VisualRecord.spec` is `null` or the IR again; the graph layout lives in `VisualRecord.layout`. IR → engine compilers (`toMermaid`, `toVegaLite`, `graphLayoutInput`, `markTexTerms`, `layoutTimeline`) stay in `@illus/render`; `@illus/core/compile` does not duplicate them. The schema was already `unknown`, so only its documentation and the `make.visualRecord()` factory (`spec: null`) changed. |
| 7 | §10 wording on Mermaid ids (W4) | Approved | Mermaid ids are **aliases** (`n0`, `n1`, … in IR order) mapped back to IR ids; rendered elements carry the IR id in `data-ir-id` / `data-target`. `docs/spec.md` is not edited; this ADR and the v1.1 changelog in `docs/contracts.md` are the record. |
| 8 | Linux visual baselines and e2e in CI (W4) | Deferred to the final gate | No CI change. `pnpm e2e` (Playwright, darwin baselines) stays a local check until the final gate adds Linux baselines (Playwright Docker image) and renderer e2e to CI. |

Also in v1.1, from the app build fix ([ADR 0009](0009-reader-build-on-typescript-5.md)): `ROLES` is checked with an identity helper instead of `satisfies` (same type), and lint bans `satisfies` in `@illus` sources.

`CONTRACTS_VERSION` is `1.1.0`; `docs/contracts.md` is regenerated and now opens with a changelog (written by `packages/illus-core/scripts/contracts.ts`). Its status line reads "approved by Shubham", since v1.0 and every v1.1 item were approved.

## Open question (contract-change request, not applied)

**Code block text loses its layout.** §5 (`Block.text`: "whitespace collapsed") and §6 step 9 collapse whitespace in every block, so `@illus/book-index` stores a Python listing as `def total(xs): s = 0 for x in xs: s += x return s`. W10's `eval-mini` sections keep line breaks and indentation, and W7's translator (§12) needs them: indentation is syntax in Python. Proposal: for `kind: 'code'` blocks, `Block.text` keeps line breaks and leading indentation (NFC, soft hyphens removed, trailing whitespace trimmed per line, tabs kept); grounding is unaffected because §16 normalises both sides before matching. Owners if accepted: W0 (schema doc, contracts v1.2), W1 (indexer). `fixtures/scripts/test/eval-mini.test.ts` currently compares code text with whitespace collapsed and must be tightened if this is accepted.

## Consequences

- W5: implement `dropElement` where an element can be removed safely; leave it out otherwise.
- W3/W9: store `spec: null` (or the IR) for IR kinds and persist `onLayout` into `VisualRecord.layout`.
- W1: may revert its `erasableSyntaxOnly: false` workaround.
- W10 (phase B): `evals/` may import `@illus/llm/server` to drive the gateway directly. The eval-mini sections are now also an EPUB (`fixtures/books/eval/eval-mini.epub`), and the indexer reproduces their section and block ids (`fixtures/scripts/test/eval-mini.test.ts`).
- Final gate: add Linux baselines and e2e to CI (item 8).
