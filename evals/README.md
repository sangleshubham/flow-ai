# @illus/evals

Eval harness for spec §18: golden sections, a runner that replays recorded runs (default) or runs the live pipeline, the §18 metrics against their v1 thresholds, dated reports with a diff against the previous one, and the §9 effort sweep.

- Owner: W10. Status: phase A (replay only; `--live` is wired in phase B once `@illus/pipeline` and `@illus/llm` exist).
- CI never calls a model. `pnpm eval` replays `evals/replay/` unless `--live` is given, and only Shubham runs `--live`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm eval` | Replays every case and writes `evals/reports/<date>.md` (a same-day rerun overwrites it) |
| `pnpm eval --cases mini-,sb-5-1` | Only cases whose id starts with one of the prefixes |
| `pnpm eval --sweep [--roles planner,critic]` | Effort sweep: each role × `low`/`medium`/`high`, written to `evals/reports/<date>-sweep.md` with the cheapest passing effort per role |
| `pnpm eval --live` | Live model calls (phase B; exits with an error today) |
| `--date YYYY-MM-DD`, `--out <dir>`, `--replay <dir>` | Report date, report directory, recordings directory |

## Layout

| Path | Contents |
| --- | --- |
| `cases/golden/<id>.json` | Golden cases (`EvalCase`): `bookRef`, `sectionId`, expected `needsVisual`, `acceptableKinds`, `mustInclude`, `mustNotInclude`, optional `trace.expectedReturn` |
| `cases/private/` | Cases from your own books (git-ignored) |
| `regressions/` | Cases exported from reader feedback (`pnpm illus:export-feedback`, phase B) |
| `replay/<id>.json` | One recorded run per case (`CaseRun`); `replay/private/` is git-ignored. `<id>@<role>@<effort>.json` is an effort-specific recording used by the sweep |
| `reports/` | `<date>.md` reports and `<date>-sweep.md` sweeps |
| `src/books/eval-mini.ts` | Short original (CC0) sections for categories the fixtures lack |

`bookRef` is `synthetic` (`fixtures/books/synthetic.epub`), `small-book` (`@illus/core/testing`), `eval-mini`, or `private:<file>` (a book in `fixtures/books/private/`). A private case without a local recording is reported as skipped, not failed.

The current recordings are **handwritten** (`"source": "handwritten"`): they exercise the harness, including a few deliberate faults (a wrong `needsVisual`, a first extraction that fails the schema, a dropped invented message, a half-grounded label). They do not measure model quality. Synthetic `sectionId`s are provisional until `@illus/book-index` (W1) fixes ordinals.

## Metrics

Computed per case by `scoreCase` and aggregated by `summarize` (thresholds in `THRESHOLDS`, from §18): `needsVisual` accuracy (a missing run counts as wrong), priority-1 plan kind in the acceptable set, schema validity of the first planner/extractor/translator attempt, mean grounding score (from `validate()` with the real matcher over the recorded context blocks), `mustInclude` recall and `mustNotInclude` violations (searched in the displayed text of the validated IRs, not in evidence quotes), critic pass rate (`criticPasses`), trace cases executed with the expected return value, and concept-model displacement. A metric with no applicable cases is `n/a` and never fails.

## Public API

`EvalCase`, `CaseRun`, `loadCases`, `replayRunner`, `runEval`, `runSweep`, `recommendEffort`, `scoreCase`, `summarize`, `meetsThresholds`, `THRESHOLDS`, `renderReport`, `writeReport`, `previousReport`, `renderSweep`, `writeSweep`. A live runner is any `CaseRunner = (case, { effortOverrides }) => Promise<CaseRun | null>`.

## Example

```ts
import { loadCases, replayRunner, runEval, writeReport } from '@illus/evals'

const cases = loadCases(['evals/cases/golden'])
const run = await runEval(cases, replayRunner('evals/replay'))
writeReport('evals/reports', run, { date: '2026-10-09', mode: 'replay' })
```

## Scripts

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm eval`
