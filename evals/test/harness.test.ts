import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  loadCases,
  meetsThresholds,
  previousReport,
  recommendEffort,
  renderReport,
  renderSweep,
  replayRunner,
  runEval,
  runSweep,
  scoreCase,
  summarize,
} from '../src/index.ts'
import type { CaseRun, EvalCase } from '../src/index.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const cases = loadCases([join(ROOT, 'cases/golden')])
const byId = (id: string) => cases.find((c) => c.id === id)!
const tmp = () => mkdtempSync(join(tmpdir(), 'illus-evals-'))

async function run(id: string): Promise<CaseRun> {
  return (await replayRunner(join(ROOT, 'replay'))(byId(id), {}))!
}

describe('scoreCase', () => {
  it('fails a case without a recording, but skips private-book cases', () => {
    expect(scoreCase(byId('mini-sum'), null)).toMatchObject({ status: 'fail', reasons: ['no run (missing recording)'] })
    const priv: EvalCase = { ...byId('mini-sum'), id: 'private-x', bookRef: 'private:ddia.epub' }
    expect(scoreCase(priv, null).status).toBe('skipped')
  })

  it('checks the trace return value against the expectation', async () => {
    const r = await run('mini-sum')
    expect(scoreCase(byId('mini-sum'), r).trace.ok).toBe(true)
    const wrong = { ...r, visuals: [{ ...r.visuals[0]!, trace: { mode: 'simulated' as const, returnValue: '12' } }] }
    expect(scoreCase(byId('mini-sum'), wrong)).toMatchObject({ status: 'fail', trace: { ok: false } })
  })

  it('counts a forbidden term shown in the visual as a violation', async () => {
    const c = { ...byId('mini-job-states'), expected: { ...byId('mini-job-states').expected, mustNotInclude: ['Retry'] } }
    expect(scoreCase(c, await run('mini-job-states')).violations).toEqual(['Retry'])
  })

  it('measures schema validity on the first attempt and grounding on the last', async () => {
    const r = scoreCase(byId('mini-stack'), await run('mini-stack'))
    expect(r.schema).toEqual({ checked: 2, firstValid: 1 })
    expect(r.grounding).toEqual([1])
  })

  it('reports a needsVisual mismatch and an unacceptable kind', async () => {
    expect(scoreCase(byId('sb-5-chapter-intro'), await run('sb-5-chapter-intro')).reasons).toContain('needsVisual true, expected false')
    const c = { ...byId('mini-bst'), expected: { ...byId('mini-bst').expected, acceptableKinds: ['graph' as const] } }
    expect(scoreCase(c, await run('mini-bst')).kind).toEqual({ actual: 'template', ok: false })
  })
})

describe('summarize and thresholds', () => {
  it('computes the §18 metrics over the golden replay set', async () => {
    const { summary, sources } = await runEval(cases, replayRunner(join(ROOT, 'replay')))
    expect(sources).toEqual({ handwritten: cases.filter((c) => !c.bookRef.startsWith('private:')).length })
    expect(summary.cases.skipped).toBe(24)
    expect(summary.metrics.displacementPx).toBeNull()
    expect(summary.metrics.meanGrounding).toBeGreaterThan(0.9)
    expect(summary.latency['no-visual']?.n).toBe(3)
    expect(meetsThresholds(summary)).toBe(true)
  })

  it('fails thresholds when a metric is below its limit', () => {
    const s = summarize([scoreCase(byId('mini-sum'), null)])
    expect(s.metrics.needsVisualAccuracy).toBe(0)
    expect(meetsThresholds(s)).toBe(false)
  })
})

describe('reports', () => {
  it('diffs against the newest earlier report and ignores sweep reports', async () => {
    const dir = tmp()
    const first = await runEval(cases, replayRunner(join(ROOT, 'replay')))
    writeFileSync(join(dir, '2026-10-01.md'), renderReport(first, { date: '2026-10-01', mode: 'replay' }))
    writeFileSync(join(dir, '2026-10-05-sweep.md'), '# sweep')
    const prev = previousReport(dir, '2026-10-09')!
    expect(prev.file).toBe('2026-10-01.md')

    const second = await runEval(cases.filter((c) => c.id !== 'mini-bst'), replayRunner(join(ROOT, 'replay')))
    const md = renderReport(second, { date: '2026-10-09', mode: 'replay', previous: prev })
    expect(md).toContain('## Changes since 2026-10-01.md')
    expect(md).toContain('- mini-bst: removed')
    expect(md).toMatch(/\| Mean grounding score \| [\d.]+ \| >= 0.90 \| pass \| (=|[+-][\d.]+) \|/)
  })

  it('pnpm eval (replay) writes a dated report from the CLI', () => {
    const out = tmp()
    const log = execFileSync(process.execPath, [join(ROOT, 'bin/run.mjs'), join(ROOT, 'src/cli.ts'), '--out', out, '--date', '2026-10-09'], { encoding: 'utf8' })
    expect(log).toMatch(/cases passed/)
    expect(readFileSync(join(out, '2026-10-09.md'), 'utf8')).toMatch(/^# Eval report 2026-10-09/)
  })

  it('--live refuses to start without the reader’s server settings', () => {
    const args = [join(ROOT, 'bin/run.mjs'), join(ROOT, 'src/cli.ts'), '--live', '--env', join(tmp(), 'missing.env')]
    expect(() => execFileSync(process.execPath, args, { stdio: 'pipe' })).toThrow()
  })
})

describe('effort sweep (§9)', () => {
  it('runs each role × low/medium/high and recommends the cheapest passing effort', async () => {
    const runner = replayRunner(join(ROOT, 'replay'))
    const rows = await runSweep(['mini-bst', 'mini-job-states', 'mini-sum'].map(byId), runner, ['planner', 'critic'])
    expect(rows.map((r) => `${r.role}@${r.effort}`)).toEqual([
      'planner@low', 'planner@medium', 'planner@high', 'critic@low', 'critic@medium', 'critic@high',
    ])
    expect(runner.fallbacks).toBe(18) // no effort-specific recordings: every run replayed the base one
    expect(recommendEffort(rows, 'planner')).toBe('low')
    expect(renderSweep(rows, { date: '2026-10-09', mode: 'replay' })).toContain('Recommended effort: **low**')
  })

  it('prefers an effort-specific recording when one exists', async () => {
    const dir = tmp()
    const base = readFileSync(join(ROOT, 'replay', 'mini-sum.json'), 'utf8')
    writeFileSync(join(dir, 'mini-sum.json'), base)
    const broken = { ...JSON.parse(base), planAttempts: [{ sectionId: 'x', needsVisual: false, reason: 'skip', items: [] }] }
    writeFileSync(join(dir, 'mini-sum@planner@low.json'), JSON.stringify(broken))
    const runner = replayRunner(dir)
    const rows = await runSweep([byId('mini-sum')], runner, ['planner'])
    expect(runner.fallbacks).toBe(2)
    expect(recommendEffort(rows, 'planner')).toBe('medium')
  })
})
