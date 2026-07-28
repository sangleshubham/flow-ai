// Report writer: evals/reports/<date>.md with metrics against thresholds, per-case results, plan usage,
// latency per path, and a diff against the previous report (§18). Each report embeds its data as JSON in
// a trailing HTML comment so the next run can diff without re-running.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { RoleName } from '@illus/core'

import { meetsThresholds, THRESHOLDS, thresholdStatus } from './metrics.ts'
import type { CaseResult, MetricKey, Summary, Threshold } from './metrics.ts'
import { recommendEffort, SWEEP_EFFORTS } from './runner.ts'
import type { EvalRun, SweepRow } from './runner.ts'

const DATA_MARK = 'eval-data'
const REPORT_NAME = /^\d{4}-\d{2}-\d{2}\.md$/

export interface ReportData {
  date: string
  mode: string
  metrics: Record<MetricKey, number | null>
  cases: Record<string, CaseResult['status']>
}

function fmt(t: Threshold, v: number | null): string {
  if (v === null) return 'n/a'
  return t.percent ? `${(v * 100).toFixed(1)}%` : Number.isInteger(v) ? String(v) : v.toFixed(2)
}

function delta(t: Threshold, now: number | null, before: number | null | undefined): string {
  if (now === null || before === null || before === undefined) return ''
  const d = now - before
  if (Math.abs(d) < 1e-9) return '='
  return `${d > 0 ? '+' : ''}${t.percent ? `${(d * 100).toFixed(1)} pt` : d.toFixed(2)}`
}

/** The newest `<date>.md` report in `dir` dated before `date`, parsed from its embedded data. */
export function previousReport(dir: string, date: string): { file: string; data: ReportData } | null {
  if (!existsSync(dir)) return null
  const file = readdirSync(dir)
    .filter((f) => REPORT_NAME.test(f) && f < `${date}.md`)
    .sort()
    .at(-1)
  if (!file) return null
  const m = new RegExp(`<!-- ${DATA_MARK} (.*) -->`).exec(readFileSync(join(dir, file), 'utf8'))
  return m ? { file, data: JSON.parse(m[1]!) as ReportData } : null
}

const esc = (s: string) => s.replace(/\|/g, '\\|')

export function renderReport(run: EvalRun, opts: { date: string; mode: string; previous?: { file: string; data: ReportData } | null }): string {
  const { summary: s, results } = run
  const prev = opts.previous?.data
  const sources = Object.entries(run.sources).map(([k, n]) => `${k}: ${n}`).join(', ') || 'none'
  const lines = [
    `# Eval report ${opts.date}`,
    '',
    `- Mode: **${opts.mode}** (runs by source: ${sources})`,
    `- Cases: ${s.cases.total} (${s.cases.passed} passed, ${s.cases.failed} failed, ${s.cases.skipped} skipped)`,
    `- Plan usage: ${s.tokens.input.toLocaleString('en')} input + ${s.tokens.output.toLocaleString('en')} output tokens`,
    `- Compared with: ${opts.previous ? opts.previous.file : 'no previous report'}`,
  ]
  if (run.sources.handwritten)
    lines.push('- Note: handwritten replay fixtures exercise the harness; they do not measure model quality.')

  lines.push('', '## Metrics (§18 thresholds)', '', '| Metric | Value | Threshold | Status | Δ vs previous |', '| --- | --- | --- | --- | --- |')
  for (const t of THRESHOLDS) {
    const v = s.metrics[t.key]
    lines.push(`| ${t.label} | ${fmt(t, v)} | ${t.op} ${fmt(t, t.value)} | ${thresholdStatus(t, v)} | ${delta(t, v, prev?.metrics[t.key])} |`)
  }

  lines.push('', '## Latency by path', '', '| Path | Runs | p50 | p95 |', '| --- | --- | --- | --- |')
  for (const [path, l] of Object.entries(s.latency)) lines.push(`| ${path} | ${l.n} | ${l.p50} ms | ${l.p95} ms |`)

  lines.push('', '## Cases', '', '| Case | Category | Status | needsVisual (exp/got) | Kind | Grounding | mustInclude | Notes |', '| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const r of results) {
    const g = r.grounding.length ? r.grounding.map((x) => x.toFixed(2)).join(', ') : '–'
    const inc = r.mustInclude.found.length + r.mustInclude.missing.length
    lines.push(
      `| ${r.caseId} | ${r.category} | ${r.status} | ${r.needsVisual.expected}/${r.needsVisual.actual ?? '–'} | ${r.kind.actual ?? '–'}${r.kind.ok === false ? ' ✗' : ''} | ${g} | ${inc ? `${r.mustInclude.found.length}/${inc}` : '–'} | ${esc(r.reasons.join('; '))} |`,
    )
  }

  if (prev) {
    const now = Object.fromEntries(results.map((r) => [r.caseId, r.status]))
    const changes = [
      ...results.filter((r) => prev.cases[r.caseId] && prev.cases[r.caseId] !== r.status).map((r) => `- ${r.caseId}: ${prev.cases[r.caseId]} → ${r.status}`),
      ...results.filter((r) => !prev.cases[r.caseId]).map((r) => `- ${r.caseId}: new (${r.status})`),
      ...Object.keys(prev.cases).filter((id) => !(id in now)).map((id) => `- ${id}: removed`),
    ]
    lines.push('', `## Changes since ${opts.previous!.file}`, '', ...(changes.length ? changes : ['- No case changed status.']))
  }

  const data: ReportData = { date: opts.date, mode: opts.mode, metrics: s.metrics, cases: Object.fromEntries(results.map((r) => [r.caseId, r.status])) }
  lines.push('', `<!-- ${DATA_MARK} ${JSON.stringify(data)} -->`, '')
  return lines.join('\n')
}

/** Writes `<dir>/<date>.md` (overwriting a same-day report) and returns its path. */
export function writeReport(dir: string, run: EvalRun, opts: { date: string; mode: string }): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${opts.date}.md`)
  writeFileSync(file, renderReport(run, { ...opts, previous: previousReport(dir, opts.date) }))
  return file
}

export function renderSweep(rows: readonly SweepRow[], opts: { date: string; mode: string; note?: string }): string {
  const t = (k: MetricKey) => THRESHOLDS.find((x) => x.key === k)!
  const lines = [`# Effort sweep ${opts.date}`, '', `- Mode: **${opts.mode}**`]
  if (opts.note) lines.push(`- Note: ${opts.note}`)
  lines.push('- Rule (§9): the cheapest effort that meets every applicable §18 threshold becomes the role’s setting, recorded in an ADR.')
  const roles = [...new Set(rows.map((r) => r.role))] as RoleName[]
  for (const role of roles) {
    lines.push('', `## ${role}`, '', '| Effort | Mean grounding | Critic pass rate | Plan usage (tokens) | Cases passed | Meets thresholds |', '| --- | --- | --- | --- | --- | --- |')
    for (const effort of SWEEP_EFFORTS) {
      const row = rows.find((r) => r.role === role && r.effort === effort)
      if (!row) continue
      const s: Summary = row.summary
      lines.push(
        `| ${effort} | ${fmt(t('meanGrounding'), s.metrics.meanGrounding)} | ${fmt(t('criticPassRate'), s.metrics.criticPassRate)} | ${(s.tokens.input + s.tokens.output).toLocaleString('en')} | ${s.cases.passed}/${s.cases.total} | ${meetsThresholds(s) ? 'yes' : 'no'} |`,
      )
    }
    lines.push('', `Recommended effort: **${recommendEffort(rows, role) ?? 'none meets the thresholds'}**`)
  }
  return `${lines.join('\n')}\n`
}

export function writeSweep(dir: string, rows: readonly SweepRow[], opts: { date: string; mode: string; note?: string }): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${opts.date}-sweep.md`)
  writeFileSync(file, renderSweep(rows, opts))
  return file
}
