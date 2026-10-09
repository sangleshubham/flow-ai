// Loads cases, runs them through a CaseRunner (replay recordings now; the live pipeline in phase B) and
// runs the §9 effort sweep.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ReasoningEffort, RoleName } from '@illus/core'

import { CaseRun, EvalCase } from './case.ts'
import { meetsThresholds, scoreCase, summarize } from './metrics.ts'
import type { CaseResult, Summary } from './metrics.ts'

export interface RunOptions {
  /** Effort per role for this run (effort sweep, §9). Roles not listed use their configured effort. */
  effortOverrides?: Partial<Record<RoleName, ReasoningEffort>>
}

/** Produces the run of one case; null when it cannot (e.g. no recording). */
export type CaseRunner = (c: EvalCase, opts: RunOptions) => Promise<CaseRun | null>

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Every `*.json` case in the given directories (missing directories are ignored), sorted by id. */
export function loadCases(dirs: readonly string[]): EvalCase[] {
  const cases: EvalCase[] = []
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
      const parsed = EvalCase.safeParse(readJson(join(dir, f)))
      if (!parsed.success) throw new Error(`${join(dir, f)}: ${parsed.error.message}`)
      cases.push(parsed.data)
    }
  }
  const seen = new Set<string>()
  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`duplicate case id ${c.id}`)
    seen.add(c.id)
  }
  return cases.sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Replays recorded runs from `dir`: `<caseId>.json`, or `private/<caseId>.json` for private books. With a
 * single effort override, `<caseId>@<role>@<effort>.json` is preferred when it exists; otherwise the base
 * recording is replayed (and `fallbacks` counts it, so a replayed sweep can say it measured nothing).
 */
export function replayRunner(dir: string): CaseRunner & { fallbacks: number } {
  const runner = async (c: EvalCase, opts: RunOptions): Promise<CaseRun | null> => {
    const base = [join(dir, `${c.id}.json`), join(dir, 'private', `${c.id}.json`)]
    const overrides = Object.entries(opts.effortOverrides ?? {})
    const variant = overrides.length === 1 ? [join(dir, `${c.id}@${overrides[0]![0]}@${overrides[0]![1]}.json`)] : []
    const file = [...variant, ...base].find((f) => existsSync(f))
    if (!file) return null
    if (overrides.length && !variant.includes(file)) runner.fallbacks++
    const parsed = CaseRun.safeParse(readJson(file))
    if (!parsed.success) throw new Error(`${file}: ${parsed.error.message}`)
    if (parsed.data.caseId !== c.id) throw new Error(`${file}: caseId ${parsed.data.caseId} does not match ${c.id}`)
    return parsed.data
  }
  runner.fallbacks = 0
  return runner
}

export interface EvalRun {
  results: CaseResult[]
  summary: Summary
  /** Runs per source, e.g. { handwritten: 13 }. */
  sources: Record<string, number>
}

/** Runs and scores every case, one at a time (live runs share the plan's rate limits). */
export async function runEval(cases: readonly EvalCase[], runner: CaseRunner, opts: RunOptions = {}): Promise<EvalRun> {
  const results: CaseResult[] = []
  const sources: Record<string, number> = {}
  for (const c of cases) {
    const run = await runner(c, opts)
    if (run) sources[run.source] = (sources[run.source] ?? 0) + 1
    results.push(scoreCase(c, run))
  }
  return { results, summary: summarize(results), sources }
}

export const SWEEP_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high']

export interface SweepRow {
  role: RoleName
  effort: ReasoningEffort
  summary: Summary
}

/** §9 effort sweep: each role × low/medium/high on the case set, other roles at their configured effort. */
export async function runSweep(cases: readonly EvalCase[], runner: CaseRunner, roles: readonly RoleName[]): Promise<SweepRow[]> {
  const rows: SweepRow[] = []
  for (const role of roles)
    for (const effort of SWEEP_EFFORTS)
      rows.push({ role, effort, summary: (await runEval(cases, runner, { effortOverrides: { [role]: effort } })).summary })
  return rows
}

/** The cheapest effort of a role whose run meets every applicable threshold, or null. */
export function recommendEffort(rows: readonly SweepRow[], role: RoleName): ReasoningEffort | null {
  for (const effort of SWEEP_EFFORTS) {
    const row = rows.find((r) => r.role === role && r.effort === effort)
    if (row && meetsThresholds(row.summary)) return effort
  }
  return null
}
