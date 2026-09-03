// @vitest-environment jsdom
// The live runner, exercised end to end in replay mode: synthetic.epub → W1 index → concept pass →
// pipeline → in-process gateway serving W3's committed fixtures → CaseRun → score. No model is called.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { liveRunner } from '../src/live.ts'
import { loadCases, scoreCase } from '../src/index.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const byId = new Map(loadCases([join(ROOT, 'cases/golden')]).map((c) => [c.id, c]))
const runner = liveRunner({
  root: join(ROOT, '..'),
  env: { ILLUS_LLM_MODE: 'replay', ILLUS_FIXTURES_DIR: join(ROOT, '../fixtures/llm') },
  flags: { templates: true },
})

describe('live runner (replay mode)', () => {
  it('runs a math section through the real pipeline and scores it', async () => {
    const c = byId.get('syn-2-1-formulas')!
    const run = (await runner(c, {}))!
    expect(run).toMatchObject({ caseId: c.id, source: 'recorded', unsupported: ['trace', 'critic'] })
    expect(run.visuals.map((v) => v.kind)).toContain('math')
    expect(run.calls.some((x) => x.role === 'planner')).toBe(true)
    const r = scoreCase(c, run)
    expect(r.needsVisual).toEqual({ expected: true, actual: true })
    expect(r.grounding.every((g) => g > 0.6)).toBe(true)
  }, 60_000)

  it('records a no-visual section', async () => {
    const c = byId.get('syn-ch4-scripted')!
    const run = (await runner(c, {}))!
    expect(run.path).toBe('no-visual')
    expect(scoreCase(c, run).status).toBe('pass')
  }, 60_000)

  it('skips a private book that is not on this machine', async () => {
    const c = { ...byId.get('syn-preface')!, id: 'p', bookRef: 'private:missing.epub' }
    expect(await runner(c, {})).toBeNull()
  })
})
