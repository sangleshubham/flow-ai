// `pnpm eval [--live] [--sweep] [--roles a,b] [--cases prefix,…] [--date YYYY-MM-DD] [--out dir] [--replay dir]`
// Replay by default: scores recorded runs from evals/replay/ and never calls a model. `--live` is for
// Shubham only (CLAUDE.md) and needs the pipeline (W3) and LLM client (W2); see evals/README.md.
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { RoleName } from '@illus/core'

import { writeReport, writeSweep } from './report.ts'
import { loadCases, replayRunner, runEval, runSweep } from './runner.ts'
import type { CaseRunner } from './runner.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    sweep: { type: 'boolean', default: false },
    roles: { type: 'string' },
    cases: { type: 'string' },
    date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
    out: { type: 'string', default: join(ROOT, 'reports') },
    replay: { type: 'string', default: join(ROOT, 'replay') },
  },
})

if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) throw new Error(`--date must be YYYY-MM-DD, got ${values.date}`)

let runner: CaseRunner & { fallbacks?: number }
if (values.live) {
  // Phase B wires this to @illus/pipeline with the live @illus/llm client (ILLUS_LLM_MODE=live).
  console.error('pnpm eval --live needs @illus/pipeline (W3) and @illus/llm (W2), which are not available yet.')
  process.exit(2)
} else runner = replayRunner(values.replay)
const mode = values.live ? 'live' : 'replay'

const prefixes = values.cases?.split(',').filter(Boolean)
const cases = loadCases([join(ROOT, 'cases/golden'), join(ROOT, 'cases/private'), join(ROOT, 'regressions')]).filter(
  (c) => !prefixes || prefixes.some((p) => c.id.startsWith(p)),
)
if (!cases.length) throw new Error('no cases selected')

if (values.sweep) {
  const roles = values.roles ? values.roles.split(',').map((r) => RoleName.parse(r.trim())) : RoleName.options
  const rows = await runSweep(cases, runner, roles)
  const note = runner.fallbacks
    ? `${runner.fallbacks} runs replayed the base recording because no effort-specific recording exists; those rows do not measure the effort.`
    : undefined
  console.log(`wrote ${writeSweep(values.out, rows, { date: values.date, mode, note })}`)
} else {
  const run = await runEval(cases, runner)
  const file = writeReport(values.out, run, { date: values.date, mode })
  const s = run.summary
  console.log(`${s.cases.passed}/${s.cases.total} cases passed (${s.cases.skipped} skipped). Wrote ${file}`)
}
