# @illus/evals

Eval harness for spec §18: 40 golden sections, a runner that replays recorded runs (default) or runs the live pipeline, the §18 metrics against their v1 thresholds, dated reports with a diff against the previous one, the §9 effort sweep, and the §16 L6 feedback export.

- Owner: W10. Decisions: [ADR 0006-w10](../docs/adr/0006-w10-grounding-validation-evals.md), [ADR 0043](../docs/adr/0043-w10-render-checks-critic-repair.md).
- CI never calls a model. `pnpm eval` replays `evals/replay/` unless `--live` is given, and only Shubham runs `--live`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm eval` | Replays every case and writes `evals/reports/<date>.md` (a same-day rerun overwrites it) |
| `pnpm eval --cases mini-,sb-5-1` | Only cases whose id starts with one of the prefixes |
| `pnpm eval --sweep [--roles planner,critic]` | Effort sweep: each role × `low`/`medium`/`high`, written to `evals/reports/<date>-sweep.md` with the cheapest passing effort per role |
| `pnpm eval --live [--env file] [--record]` | Live model calls on your plan (below) |
| `pnpm illus:export-feedback <cache.json>… [--book-ref private:<file>]` | Turns reader feedback into regression cases (below) |
| `--date YYYY-MM-DD`, `--out <dir>`, `--replay <dir>` | Report date, report directory, recordings directory |

## Running the live eval (Shubham)

The live runner indexes each case's book in Node, runs the concept pass and the real pipeline, and calls the model through the same gateway the reader uses, **in-process**: no reader needs to be running.

1. Sign in once in the reader on this laptop (`pnpm dev`, Continue with ChatGPT). That fills the encrypted token store in `ILLUS_DATA_DIR`.
2. Check `apps/reader/.env.local` has `ILLUS_TOKEN_ENC_KEY`, `ILLUS_PUBLIC_URL`, `ILLUS_DATA_DIR` (a relative path is taken relative to the env file) and, if you use them, `ILLUS_MODELS_JSON` and the request caps. `ILLUS_LLM_MODE` in that file is ignored: `--live` always runs live.
3. Put your own books in `fixtures/books/private/` and fill the placeholder cases (`evals/cases/golden/private-*.json`): set `bookRef` to `private:<file name>` and `sectionId` to the section's id (ids look like `<bookId>:<spine index>:<heading path>:<ordinal>`, as in the synthetic cases; an unknown id fails with `section … is not in …`). Fill `mustInclude`. Cases of your own books can also live in `evals/cases/private/` (git-ignored).
4. Run `pnpm eval --live` (or `--live --cases syn-,mini-` for a cheap first try). Add `--record` to keep each run as a replay (`evals/replay/`, or `evals/replay/private/` for private books, git-ignored) so later `pnpm eval` runs re-score it for free.
5. Effort sweep (§9): `pnpm eval --live --sweep --roles planner,extractor.graph` runs each listed role at `low`, `medium` and `high` (other roles at their configured effort) and writes `<date>-sweep.md` with the cheapest effort meeting every threshold. Record the chosen efforts in an ADR and in `ILLUS_MODELS_JSON`. A full sweep over every role is 17 × 3 runs of the set; it counts against the local caps and the five-hour plan window, so sweep a few roles at a time.

Limits: Node has no Pyodide worker and no renderer, so live runs report trace and critic metrics as not measured (`unsupported`); check those in the reader with the `tracer` and `critic` flags on. The concept pass runs once per book per invocation, on the first case's efforts. A plan-limit stop aborts the run with a clear error.

## Feedback export (§16 L6)

1. In the reader, vote thumbs down or use "This is wrong" on elements, then "Export cache JSON" in the Illustrate settings, with that book open.
2. `pnpm illus:export-feedback ~/Downloads/<bookId>-illustrations.json` writes one case per report: open books into `evals/regressions/`, others into `evals/regressions/private/` (git-ignored). Existing files are kept.
3. Review each case: the export assumes the planned kind was acceptable and puts the labels of wrong elements in `mustNotInclude`; your notes are in `notes`.

## Layout

| Path | Contents |
| --- | --- |
| `cases/golden/<id>.json` | 40 golden cases (`EvalCase`) in the §18 shape: 8 architecture, 6 protocol, 4 state, 8 data structure, 8 algorithmic, 2 math, 4 narrative. 16 use open books, 24 are placeholders for private books |
| `cases/private/` | Cases from your own books (git-ignored) |
| `regressions/`, `regressions/private/` | Cases exported from reader feedback (the second is git-ignored) |
| `replay/<id>.json` | One run per open case (`CaseRun`); `replay/private/` is git-ignored. `<id>@<role>@<effort>.json` is an effort-specific recording used by the sweep |
| `reports/` | `<date>.md` reports and `<date>-sweep.md` sweeps |
| `src/books/` | `eval-mini.ts` (CC0 sections) and `index-epub.ts` (W1's indexer over jsdom) |
| `bin/run.mjs` | Runs the TypeScript entries through Vite (TSX templates, epub.js) |

`bookRef` is `synthetic` (`fixtures/books/synthetic.epub`), `small-book` (`@illus/core/testing`), `eval-mini` (`fixtures/books/eval/eval-mini.epub`), or `private:<file>` (a book in `fixtures/books/private/`). A private case without a book or recording is reported as skipped, not failed.

The committed recordings are **handwritten** (`"source": "handwritten"`): they exercise the harness, including deliberate faults (a wrong `needsVisual`, a first extraction that fails the schema, a dropped invented message, a half-grounded label). They do not measure model quality. Three were produced by the live runner in replay mode over W3's hand-written fixtures. Synthetic cases are checked against W1's indexer (`test/synthetic-ids.test.ts`).

## Metrics

Computed per case by `scoreCase` and aggregated by `summarize` (thresholds in `THRESHOLDS`, from §18): `needsVisual` accuracy (a missing run counts as wrong), priority-1 plan kind in the acceptable set, schema validity of the first planner/extractor/translator attempt, mean grounding score (from `validate()` with the real matcher and W5's template registry over the recorded blocks; remaining validation errors fail the case), `mustInclude` recall and `mustNotInclude` violations (in the displayed text of the validated IRs, not in evidence quotes), critic pass rate (`criticPasses`), trace cases executed with the expected return value, and concept-model displacement. A metric with no applicable cases is `n/a` and never fails.

## Public API

`EvalCase`, `CaseRun`, `loadCases`, `replayRunner`, `runEval`, `runSweep`, `recommendEffort`, `scoreCase`, `summarize`, `meetsThresholds`, `THRESHOLDS`, `renderReport`, `writeReport`, `previousReport`, `renderSweep`, `writeSweep`, `feedbackCases`. The live runner is `liveRunner({ root, env })` in `src/live.ts` (not re-exported: it pulls in the pipeline and the Node gateway). Any `CaseRunner = (case, { effortOverrides }) => Promise<CaseRun | null>` works.

## Example

```ts
import { loadCases, replayRunner, runEval, writeReport } from '@illus/evals'

const cases = loadCases(['evals/cases/golden'])
const run = await runEval(cases, replayRunner('evals/replay'))
writeReport('evals/reports', run, { date: '2026-10-10', mode: 'replay' })
```

## Scripts

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm eval` · `pnpm export-feedback`
