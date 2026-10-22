import {
  COMPILER_VERSION,
  GraphIR,
  LlmError,
  animationTargets,
  defaultStoryboard,
  validateAnimation as validateCoreAnimation,
  visualKey,
} from '@illus/core'
import type { LlmCall, TemplateRegistry, VisualPlan } from '@illus/core'
import { make } from '@illus/core/testing'
import { DEFAULT_MODELS, resolveRoute } from '@illus/llm'
import { describe, expect, test, vi } from 'vitest'

import { createLimiter, overrideKind, reportBlock } from '../src/index.ts'
import type { PipelineDeps, ReviewHook, SectionJob } from '../src/index.ts'
import {
  CHAPTER_ID,
  SECTION_COMMIT_ID as C,
  SECTION_LEADERS_ID as L,
  TRACE_CODE_ID,
  collect,
  fakeLlm,
  flagsOff,
  pipelineWith,
  seededRepos,
  seededTraceRepos,
} from './helpers.ts'
import type { Call } from './helpers.ts'

const plan = (o: Partial<VisualPlan> = {}) => make.visualPlan(o)
const badGraph = (): GraphIR => {
  const g = make.graphIR()
  const bad = {
    ...g.nodes[0]!.evidence,
    quote: 'words that never appear in the book',
  }
  return {
    ...g,
    nodes: g.nodes.map((n) => ({ ...n, evidence: bad })),
    edges: g.edges.map((e) => ({ ...e, evidence: bad })),
  }
}
const byRole =
  (map: Partial<Record<Call['role'], (c: Call) => unknown>>) => (c: Call) => {
    const f = map[c.role]
    if (!f) throw new Error(`unexpected call ${c.role}`)
    return f(c)
  }

describe('requestSection', () => {
  test('plans, extracts, validates and stores; a second request is served from the cache', async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
      }),
    )
    const pipeline = pipelineWith(repos, llm)
    const first = await collect(pipeline.requestSection(L))
    expect(first.of('plan')[0]).toMatchObject({
      fromCache: false,
      partialContext: false,
    })
    const [ready] = first.of('item-ready')
    expect(ready!.fromCache).toBe(false)
    expect(ready!.record).toMatchObject({
      sectionId: L,
      planItemId: 'p1',
      kind: 'graph',
      spec: null,
      validation: { ok: true, retried: false, escalated: false },
      models: { 'extractor.graph': 'gpt-6.1-sol@medium' },
      promptVersions: { 'extractor.graph': '1.0.0' },
      usageTokens: 110,
    })
    expect(first.of('item-progress').map((p) => p.stage)).toEqual([
      'queued',
      'extracting',
      'storing',
    ])
    expect(first.of('done')).toEqual([{ cancelled: false }])
    // The planner saw the packed context; the extractor got the plan item.
    expect(llm.calls[0]!.ctx.body).toContain(`<section id="${L}"`)
    expect(llm.calls[1]!.ctx.body).toContain(
      '<plan_item id="p1" kind="graph" animate="true">',
    )
    expect(llm.calls[1]!.opts.schemaName).toBe('GraphSource')

    const second = await collect(pipeline.requestSection(L))
    expect(second.of('plan')[0]!.fromCache).toBe(true)
    expect(second.of('item-ready')[0]).toMatchObject({
      fromCache: true,
      record: ready!.record,
    })
    expect(llm.calls).toHaveLength(2)
  })

  test('the planner is told the available kinds; toggling a flag changes the plan key and re-plans', async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
      }),
    )
    const kindsOf = (c: Call) =>
      /<available_kinds>(.*)<\/available_kinds>/.exec(c.ctx.body)?.[1]
    const planners = () => llm.calls.filter((c) => c.role === 'planner')

    const off = await collect(pipelineWith(repos, llm).requestSection(L))
    expect(kindsOf(planners()[0]!)).toBe(
      'graph, sequence, state, class, er, chart, math, timeline',
    )
    const again = await collect(pipelineWith(repos, llm).requestSection(L))
    expect(again.of('plan')[0]!.fromCache).toBe(true)

    const on = await collect(
      pipelineWith(repos, llm, {
        flags: flagsOff({ templates: true, tracer: true }),
      }).requestSection(L),
    )
    expect(on.of('plan')[0]!.fromCache).toBe(false)
    expect(on.of('plan')[0]!.record.cacheKey).not.toBe(
      off.of('plan')[0]!.record.cacheKey,
    )
    expect(kindsOf(planners()[1]!)).toBe(
      'graph, sequence, state, class, er, template, chart, math, trace, timeline',
    )

    const templates = {
      getTemplate: () => undefined,
      listTemplates: () => [{ id: 'array' }, { id: 'comparison' }],
    } as unknown as TemplateRegistry
    await collect(
      pipelineWith(repos, llm, {
        flags: flagsOff({ templates: true }),
        templates,
      }).requestSection(L, { force: true }),
    )
    expect(kindsOf(planners()[2]!)).toBe(
      'graph, sequence, state, class, er, template:array, template:comparison, chart, math, timeline',
    )
  })

  test('the plan overview and item captions reach the stored record and the plan event', async () => {
    const repos = await seededRepos()
    const overview = 'Servers agree on one log. A leader orders every write.'
    const caption = 'Each arrow is one replicated write.'
    const llm = fakeLlm(
      byRole({
        planner: () => plan({ overview, items: [make.planItem({ caption })] }),
        'extractor.graph': () => make.graphSource(),
      }),
    )
    const r = await collect(pipelineWith(repos, llm).requestSection(L))
    const event = r.of('plan')[0]!
    expect(event.plan).toMatchObject({ overview, items: [{ caption }] })
    expect((await repos.plans.get(event.record.cacheKey))!.plan).toMatchObject({
      overview,
      items: [{ caption }],
    })
  })

  test('needsVisual: false emits no-visual; "illustrate anyway" re-plans with force', async () => {
    const repos = await seededRepos()
    let forced = false
    const llm = fakeLlm(
      byRole({
        planner: (c) => {
          forced = c.ctx.body.includes('<force>')
          return forced
            ? plan()
            : plan({
                needsVisual: false,
                reason: 'Only restates the previous section.',
                items: [],
              })
        },
        'extractor.graph': () => make.graphSource(),
      }),
    )
    const pipeline = pipelineWith(repos, llm)
    const r1 = await collect(pipeline.requestSection(L))
    expect(r1.of('no-visual')).toEqual([
      { reason: 'Only restates the previous section.' },
    ])
    expect(r1.of('item-ready')).toEqual([])
    const r2 = await collect(pipeline.requestSection(L, { force: true }))
    expect(forced).toBe(true)
    expect(r2.of('item-ready')).toHaveLength(1)
  })

  test('every planned item behind a disabled flag emits no-visual naming the flags', async () => {
    const repos = await seededRepos()
    const items = [
      make.planItem({ planItemId: 't', kind: 'template', templateId: 'array' }),
    ]
    const llm = fakeLlm(byRole({ planner: () => plan({ items }) }))
    const r = await collect(pipelineWith(repos, llm).requestSection(L))
    expect(r.of('no-visual')[0]!.reason).toContain('turned off: templates')
    expect(llm.calls).toHaveLength(1)
  })

  test('a needsVisual plan with nothing left to run emits no-visual', async () => {
    const llm = fakeLlm(byRole({ planner: () => plan() }))
    const pipeline = pipelineWith(await seededRepos(), llm)
    for (const opts of [
      { planItemId: 'nope' },
      { kindOverride: 'html' as const }, // htmlFallback is off
    ]) {
      const r = await collect(pipeline.requestSection(L, opts))
      expect(r.of('no-visual')).toHaveLength(1)
      expect(r.of('item-progress')).toEqual([])
      expect(r.of('done')).toEqual([{ cancelled: false }])
    }
    expect(llm.calls.map((c) => c.role)).toEqual(['planner'])
  })

  test('a call that returns after cancel starts no retry, animation or repair', async () => {
    const cases: [string, Partial<Record<Call['role'], unknown>>][] = [
      ['extractor.graph', { 'extractor.graph': make.graphSource(badGraph()) }],
      ['extractor.graph', { 'extractor.graph': make.graphSource() }],
      [
        'animator',
        { 'extractor.graph': make.graphSource(), animator: make.animationIR() },
      ],
    ]
    for (const [cancelIn, answers] of cases) {
      const ref = {} as { job: SectionJob }
      const base = fakeLlm(
        byRole({
          planner: () => plan(),
          ...Object.fromEntries(
            Object.entries(answers).map(([role, data]) => [
              role,
              () => {
                if (role === cancelIn) ref.job.cancel()
                return data
              },
            ]),
          ),
        }),
      )
      // A provider that finishes its answer even though the signal fired meanwhile.
      const deaf: LlmCall = {
        call: (role, ctx, { signal: _signal, ...opts } = {}) =>
          base.call(role, ctx, opts),
      }
      ref.job = pipelineWith(await seededRepos(), deaf, {
        flags: flagsOff({ animations: true }),
        validateAnimation: () => [
          {
            layer: 'animation',
            severity: 'error',
            code: 'animation-grounding',
            message: 'bad',
          },
        ],
      }).requestSection(L)
      const r = await collect(ref.job)
      expect(base.calls.map((c) => c.role)).toEqual([
        'planner',
        ...Object.keys(answers),
      ])
      expect(r.of('done')).toEqual([{ cancelled: true }])
    }
  })

  test('over 30% dropped: retry with the validator report, then escalate once', async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': (c) =>
          c.opts.escalate ? make.graphSource() : make.graphSource(badGraph()),
      }),
    )
    const r = await collect(pipelineWith(repos, llm).requestSection(L))
    const ex = llm.calls.filter((c) => c.role === 'extractor.graph')
    expect(ex.map((c) => c.opts.escalate ?? false)).toEqual([
      false,
      false,
      true,
    ])
    expect(ex[1]!.ctx.body).toContain(
      '<validator_report dropped="8" total="8">',
    )
    expect(ex[2]!.ctx.body).toContain('<validator_report')
    expect(r.of('item-progress').map((p) => p.stage)).toEqual([
      'queued',
      'extracting',
      'retrying',
      'escalating',
      'storing',
    ])
    expect(r.of('item-ready')[0]!.record).toMatchObject({
      validation: { retried: true, escalated: true },
      models: { 'extractor.graph': 'gpt-6-astra@medium' },
    })
  })

  test('ADR 0060: an escalated visual is stored under the requested-route key, so a revisit is a cache hit with no calls', async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': (c) =>
          c.opts.escalate ? make.graphSource() : make.graphSource(badGraph()),
      }),
    )
    const first = await collect(pipelineWith(repos, llm).requestSection(L))
    const stored = first.of('item-ready')[0]!.record
    // The run that actually produced the IR stays in the record.
    expect(stored).toMatchObject({
      validation: { retried: true, escalated: true },
      models: { 'extractor.graph': 'gpt-6-astra@medium' },
    })
    const calls = llm.calls.length
    const again = await collect(pipelineWith(repos, llm).requestSection(L))
    expect(again.of('item-ready')).toEqual([
      { planItemId: 'p1', record: stored, fromCache: true },
    ])
    expect(again.of('item-progress').map((p) => p.stage)).toEqual([
      'queued',
      'cached',
    ])
    expect(llm.calls).toHaveLength(calls)
  })

  test('ADR 0060: a visual an older build stored under the escalated-route key is still a cache hit', async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
      }),
    )
    const first = await collect(pipelineWith(repos, llm).requestSection(L))
    const planRecord = first.of('plan')[0]!.record
    const record = first.of('item-ready')[0]!.record
    const deep = resolveRoute(DEFAULT_MODELS, 'extractor.graph', true).chain[0]!
    const legacyKey = await visualKey({
      planKey: planRecord.cacheKey,
      planItem: planRecord.plan.items[0]!,
      extractor: {
        promptVersion: record.promptVersions['extractor.graph']!,
        ...deep,
      },
      compilerVersion: COMPILER_VERSION,
    })
    expect(legacyKey).not.toBe(record.cacheKey)
    await repos.visuals.delete(record.cacheKey)
    await repos.visuals.put({ ...record, cacheKey: legacyKey })

    const none = fakeLlm(() => {
      throw new Error('no model call expected')
    })
    const again = await collect(pipelineWith(repos, none).requestSection(L))
    expect(again.of('item-ready')[0]).toMatchObject({
      fromCache: true,
      record: { cacheKey: legacyKey },
    })
    expect(none.calls).toHaveLength(0)
  })

  test('a structural error (isolated nodes) is retried with the validator report, not failed outright', async () => {
    const repos = await seededRepos()
    const good = make.graphSource()
    const isolated = make.graphSource({ ...make.graphIR(), edges: [] })
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': (c) =>
          c.ctx.body.includes('<validator_report') ? good : isolated,
      }),
    )
    const r = await collect(pipelineWith(repos, llm).requestSection(L))
    const ex = llm.calls.filter((c) => c.role === 'extractor.graph')
    expect(ex).toHaveLength(2)
    expect(ex[1]!.ctx.body).toContain('isolated-nodes')
    expect(r.of('item-ready')[0]!.record).toMatchObject({
      validation: { retried: true, escalated: false },
    })
  })

  test('graph source lines that do not parse are dropped, counted and quoted back on a retry (ADR 0049)', async () => {
    const repos = await seededRepos()
    const good = make.graphSource()
    const broken = {
      source: `${good.source}\nGhost @b99 "nothing here at all"\nLeader - Log @b0 "The leader accepts client requests"\nA [icon: server @b0 "x y z"`,
    }
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': (c) =>
          c.ctx.body.includes('<validator_report') ? good : broken,
      }),
    )
    const r = await collect(pipelineWith(repos, llm).requestSection(L))
    const ex = llm.calls.filter((c) => c.role === 'extractor.graph')
    // 3 of 11 statements dropped (27%): kept without a retry, the drops recorded in the report.
    expect(ex).toHaveLength(1)
    const v = r.of('item-ready')[0]!.record.validation
    expect(v).toMatchObject({
      ok: true,
      retried: false,
      counts: { dropped: 3, total: 11 },
    })
    expect(
      v.issues.filter((i) => i.code.startsWith('dsl-')).map((i) => i.code),
    ).toEqual(['dsl-unknown-block', 'dsl-bad-connector', 'dsl-syntax'])
    expect(reportBlock(v)).toContain('dsl-unknown-block')
  })

  test('still failing after the retry → item-failed with the report; roles without escalation stop after the retry', async () => {
    const repos = await seededRepos()
    const badChart = {
      ...make.chartIR(),
      series: [
        {
          ...make.chartIR().series[0]!,
          evidence: { blockId: 'x', quote: 'nothing like this anywhere' },
        },
      ],
    }
    const llm = fakeLlm(
      byRole({
        planner: () =>
          plan({ items: [make.planItem({ kind: 'chart', animate: false })] }),
        'extractor.chart': () => badChart,
      }),
    )
    const r = await collect(pipelineWith(repos, llm).requestSection(L))
    expect(
      llm.calls
        .filter((c) => c.role === 'extractor.chart')
        .map((c) => c.opts.escalate ?? false),
    ).toEqual([false, false])
    const [failed] = r.of('item-failed')
    expect(failed).toMatchObject({
      planItemId: 'p1',
      code: 'validation',
      report: { ok: false, retried: true, escalated: false },
    })
    expect(await repos.visuals.listBySection('0123456789abcdef', L)).toEqual([])
  })

  test('an L1 schema error counts as an unusable extraction', async () => {
    const repos = await seededRepos()
    let n = 0
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => {
          if (n++ === 0)
            throw new LlmError('schema', 'GraphSource output failed validation')
          return make.graphSource()
        },
      }),
    )
    const r = await collect(pipelineWith(repos, llm).requestSection(L))
    expect(r.of('item-ready')[0]!.record.validation.retried).toBe(true)
  })

  test('navigating away cancels the planner and aborts in-flight extractor calls; the job emits done', async () => {
    const repos = await seededRepos()
    let releasePlanner!: () => void
    const plannerGate = new Promise<void>((r) => (releasePlanner = r))
    let releaseExtractor!: () => void
    const extractorGate = new Promise<void>((r) => (releaseExtractor = r))
    let plannerStarted!: () => void
    const bPlanning = new Promise<void>((r) => (plannerStarted = r))
    let extractorStarted!: () => void
    const started = new Promise<void>((r) => (extractorStarted = r))
    const llm = fakeLlm(
      byRole({
        planner: async (c) => {
          if (c.ctx.body.includes(`<section id="${C}"`)) {
            plannerStarted()
            await plannerGate
          }
          return plan({
            sectionId: L,
            items: [
              make.planItem(),
              make.planItem({ planItemId: 'p2', priority: 2 }),
            ],
          })
        },
        'extractor.graph': async () => {
          extractorStarted()
          await extractorGate
          return make.graphSource()
        },
      }),
    )
    const pipeline = pipelineWith(repos, llm)

    // Job A (5.1) reaches its first extractor call; then the reader moves to 5.2 (job B), whose planner hangs.
    const a = collect(pipeline.requestSection(L))
    await started
    const jobB = pipeline.requestSection(C)
    const b = collect(jobB)
    releaseExtractor()
    const ra = await a
    expect(ra.of('done')).toEqual([{ cancelled: true }])
    expect(ra.of('item-ready')).toEqual([]) // cancelled jobs emit nothing more…
    // …the extractor call got the job's signal and was aborted; nothing retried, p2 never started.
    const extractions = llm.calls.filter((c) => c.role === 'extractor.graph')
    expect(extractions).toHaveLength(1)
    expect(extractions[0]!.opts.signal!.aborted).toBe(true)
    expect(await repos.visuals.listBySection('0123456789abcdef', L)).toEqual([])

    // Moving on again cancels B's planner call.
    await bPlanning
    pipeline.requestSection(L)
    releasePlanner()
    const rb = await b
    expect(rb.of('done')).toEqual([{ cancelled: true }])
    expect(rb.of('plan')).toEqual([])
    expect(
      llm.calls.find((c) => c.ctx.body.includes(`<section id="${C}"`))!.opts
        .signal!.aborted,
    ).toBe(true)
  })

  test('kind override and instruction produce new records and keep the old ones', async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
        'extractor.mermaid': () => make.sequenceIR(),
      }),
    )
    const pipeline = pipelineWith(repos, llm)
    await collect(pipeline.requestSection(L))
    const over = await collect(
      pipeline.requestSection(L, {
        kindOverride: 'sequence',
        planItemId: 'p1',
      }),
    )
    expect(over.of('item-ready')[0]!.record.kind).toBe('sequence')
    expect(llm.calls.at(-1)!.opts.schemaName).toBe('SequenceIR')
    const instr = await collect(
      pipeline.requestSection(L, { instruction: 'Show only the leader side.' }),
    )
    expect(llm.calls.at(-1)!.ctx.body).toContain(
      '<user_instruction>Show only the leader side.</user_instruction>',
    )
    expect(instr.of('item-ready')[0]!.record.instruction).toBe(
      'Show only the leader side.',
    )
    expect(await repos.visuals.listByPlanItem('p1')).toHaveLength(3)
    expect(() =>
      pipeline.requestSection(L, { instruction: 'x'.repeat(301) }),
    ).toThrow(/300/)
  })

  test('mergedInto resolves to the target section; a missing index waits for indexNow, then plans with partial context', async () => {
    const repos = await seededRepos()
    await repos.sections.put({
      ...(await repos.sections.get(C))!,
      mergedInto: L,
    })
    await repos.sectionIndex.delete(L)
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
      }),
    )
    const asked: string[] = []
    const pipeline = pipelineWith(repos, llm, {
      indexWaitMs: 5,
      concepts: { indexNow: (id) => (asked.push(id), new Promise(() => {})) },
    })
    const job = pipeline.requestSection(C)
    const r = await collect(job)
    expect(job.sectionId).toBe(L)
    expect(asked).toEqual([L])
    expect(r.of('plan')[0]).toMatchObject({
      partialContext: true,
      record: { partialContext: true },
    })
  })

  test('a cached plan is served without waiting for indexNow; the wait applies only when a model call needs context', async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
      }),
    )
    const first = await collect(pipelineWith(repos, llm).requestSection(L))
    const stored = first.of('item-ready')[0]!.record
    await repos.sectionIndex.delete(L)
    const calls = llm.calls.length

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // Real macrotask turns (crypto hashing runs off-thread) for up to 2 s of wall time; the fake timers never advance.
    const until = async (done: () => boolean) => {
      const end = Date.now() + 2_000
      while (!done() && Date.now() < end)
        await new Promise<void>((r) => setImmediate(r))
    }
    try {
      const asked: string[] = []
      const pipeline = pipelineWith(repos, llm, {
        concepts: {
          indexNow: (id) => (asked.push(id), new Promise(() => {})),
        },
      })
      let settled = false
      const pending = collect(pipeline.requestSection(L)).then((r) => {
        settled = true
        return r
      })
      await until(() => settled)
      expect(settled).toBe(true)
      const r = await pending
      expect(r.of('plan')[0]).toMatchObject({ fromCache: true })
      expect(r.of('item-ready')).toEqual([
        { planItemId: 'p1', record: stored, fromCache: true },
      ])
      expect(asked).toEqual([])
      expect(llm.calls).toHaveLength(calls)

      // A cached plan whose visual is missing still gives the extractor its concept index first.
      await repos.visuals.delete(stored.cacheKey)
      const miss = collect(pipeline.requestSection(L))
      await until(() => asked.length > 0)
      expect(asked).toEqual([L])
      expect(llm.calls).toHaveLength(calls)
      await vi.advanceTimersByTimeAsync(20_000)
      const m = await miss
      expect(m.of('item-ready')[0]!.fromCache).toBe(false)
      expect(llm.calls.slice(calls).map((c) => c.role)).toEqual([
        'extractor.graph',
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  test('flag-gated routes: template filtered when off; animate, trace and concept-model routes when on', async () => {
    const repos = await seededRepos()
    const items = [
      make.planItem({ planItemId: 'g', animate: true, newConceptModel: 'c1' }),
      make.planItem({
        planItemId: 't',
        kind: 'template',
        templateId: 'array',
        priority: 2,
        animate: false,
      }),
      make.planItem({
        planItemId: 'tr',
        kind: 'trace',
        codeBlockId: TRACE_CODE_ID,
        priority: 3,
        animate: false,
      }),
    ]
    const llm = fakeLlm(
      byRole({
        planner: () => plan({ items }),
        'extractor.graph': () => make.graphSource(),
        animator: () => make.animationIR(),
        translator: () => make.translation(),
      }),
    )
    const off = await collect(pipelineWith(repos, llm).requestSection(L))
    expect(off.of('plan')[0]!.plan.items.map((i) => i.planItemId)).toEqual([
      'g',
    ])
    expect(off.of('item-ready')[0]!.record.animation).toBeUndefined()

    const repos2 = await seededTraceRepos()
    const patched: string[] = []
    const on = await collect(
      pipelineWith(repos2, llm, {
        flags: flagsOff({
          animations: true,
          tracer: true,
          conceptModels: true,
        }),
        traceRunner: { runTrace: async () => [make.scenarioTrace()] },
        conceptModels: async ({ planItem }) => {
          patched.push(planItem.planItemId)
          return {
            kind: 'graph',
            ir: make.graphIR(),
            report: make.validationReport(),
            promptVersions: { patcher: '1.0.0' },
            models: { patcher: 'gpt-6.1-sol@medium' },
            usageTokens: 5,
          }
        },
        validateAnimation: () => [],
      }).requestSection(L),
    )
    const ready = Object.fromEntries(
      on.of('item-ready').map((e) => [e.planItemId, e.record]),
    )
    expect(patched).toEqual(['g'])
    expect(ready.g!.animation).toEqual(make.animationIR())
    expect(ready.g!.models).toEqual({
      patcher: 'gpt-6.1-sol@medium',
      animator: 'gpt-6.1-sol@medium',
    })
    expect(ready.tr).toMatchObject({
      kind: 'trace',
      ir: null,
      traceKey: expect.any(String),
    })
    expect(await repos2.traces.get(ready.tr!.traceKey!)).toMatchObject({
      mode: 'executed',
      codeBlockId: TRACE_CODE_ID,
    })
    expect(on.of('plan')[0]!.plan.items.map((i) => i.planItemId)).toEqual([
      'g',
      'tr',
    ])
  })

  test("without a conceptModels dep, the conceptModels flag routes to W8's createConceptModels (patcher)", async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(
      byRole({
        planner: () =>
          plan({ items: [make.planItem({ newConceptModel: 'c1' })] }),
        patcher: () => {
          throw new LlmError('upstream', 'patcher reached')
        },
      }),
    )
    const r = await collect(
      pipelineWith(repos, llm, {
        flags: flagsOff({ conceptModels: true }),
      }).requestSection(L),
    )
    expect(llm.calls.map((c) => c.role)).toEqual(['planner', 'patcher'])
    expect(r.of('item-failed')[0]).toMatchObject({
      planItemId: 'p1',
      code: 'upstream',
    })
    expect(r.of('item-progress').map((p) => p.stage)).toContain('patching')
  })

  test('review gets the extractor context, permitted blocks and plan item; its record is stored', async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
      }),
    )
    const seen: Parameters<ReviewHook>[1][] = []
    const finding = {
      layer: 'render' as const,
      severity: 'warning' as const,
      code: 'label-overlap',
      message: 'two labels overlap',
    }
    const review: ReviewHook = async (record, ctx) => {
      seen.push(ctx)
      return {
        ...record,
        validation: {
          ...record.validation,
          issues: [...record.validation.issues, finding],
        },
      }
    }
    const r = await collect(
      pipelineWith(repos, llm, { review }).requestSection(L),
    )
    const record = r.of('item-ready')[0]!.record
    expect(record.validation.issues).toContainEqual(finding)
    expect(await repos.visuals.get(record.cacheKey)).toEqual(record)
    expect(seen[0]!.context).toEqual(llm.calls[1]!.ctx)
    expect([...seen[0]!.validation.blocks.keys()].length).toBeGreaterThan(0)
    expect(seen[0]!.planItem.planItemId).toBe('p1')
    expect(seen[0]!.signal).toBeInstanceOf(AbortSignal)
    expect(r.of('item-progress').map((p) => p.stage)).toEqual([
      'queued',
      'extracting',
      'storing',
      'critic',
    ])

    // A failing review stores the unreviewed record; a cache hit is not reviewed again.
    const repos2 = await seededRepos()
    const failed = await collect(
      pipelineWith(repos2, llm, {
        review: async () => {
          throw new Error('render failed')
        },
      }).requestSection(L),
    )
    expect(
      failed.of('item-ready')[0]!.record.validation.issues,
    ).not.toContainEqual(finding)
    const cached = await collect(
      pipelineWith(repos, llm, { review }).requestSection(L),
    )
    expect(cached.of('item-ready')[0]!.fromCache).toBe(true)
    expect(seen).toHaveLength(1)
  })

  test('illustrate selection builds a synthetic section with the parent as path context', async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
      }),
    )
    const job = pipelineWith(repos, llm).requestSelection({
      parentSectionId: L,
      blockIds: [`${L}#b0`, `${L}#b1`],
    })
    const r = await collect(job)
    expect(job.sectionId).toMatch(new RegExp(`^${L}~sel-[0-9a-f]{12}$`))
    expect(llm.calls[0]!.ctx.body).toContain(
      '<summary section="Leaders and Followers">',
    )
    expect(llm.calls[0]!.ctx.body).not.toContain(`${L}#b2`)
    expect(r.of('plan')[0]!.record.sectionId).toBe(job.sectionId)
  })

  test('item-preview carries the validated IR before animation and review; item-ready supersedes it (ADR 0054)', async () => {
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
        animator: () => make.animationIR(),
      }),
    )
    const repos = await seededRepos()
    const order: string[] = []
    const review: ReviewHook = async (record) => {
      order.push('review')
      return record
    }
    const job = pipelineWith(repos, llm, {
      flags: flagsOff({ animations: true }),
      validateAnimation: () => [],
      review,
    }).requestSection(L)
    job.on('item-preview', () => order.push('preview'))
    job.on('item-progress', (p) => order.push(p.stage))
    const r = await collect(job)
    const preview = r.of('item-preview')[0]!.record
    const ready = r.of('item-ready')[0]!.record
    expect(order.indexOf('preview')).toBeLessThan(order.indexOf('animating'))
    expect(preview.animation).toBeUndefined()
    expect(preview.ir).toEqual(ready.ir)
    expect(preview.cacheKey).toBe(ready.cacheKey)
    expect(ready.animation).toEqual(make.animationIR())
    expect(await repos.visuals.get(ready.cacheKey)).toEqual(ready)

    // Nothing left after extraction (no animation, no review): no preview, only item-ready.
    const plain = await collect(
      pipelineWith(await seededRepos(), llm).requestSection(L),
    )
    expect(plain.of('item-preview')).toEqual([])
    expect(plain.of('item-ready')).toHaveLength(1)
    // A cache hit never previews.
    const cached = await collect(
      pipelineWith(repos, llm, {
        flags: flagsOff({ animations: true }),
        review,
      }).requestSection(L),
    )
    expect(cached.of('item-preview')).toEqual([])
  })

  test('the animator gets the IR targets and supported actions', async () => {
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
        animator: () => make.animationIR(),
      }),
    )
    await collect(
      pipelineWith(await seededRepos(), llm, {
        flags: flagsOff({ animations: true }),
        validateAnimation: () => [],
      }).requestSection(L),
    )
    const { targets, supportedActions } = animationTargets(make.graphIR())
    expect(targets.length).toBeGreaterThan(0)
    expect(supportedActions).toContain('token')
    const body = llm.calls.find((c) => c.role === 'animator')!.ctx.body
    expect(body).toContain(
      `</ir><targets>${targets.join(
        ', ',
      )}</targets><supported_actions>${supportedActions.join(
        ',',
      )}</supported_actions>`,
    )
  })

  test('animation validation receives only packed evidence blocks, excluding later sections', async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
        animator: () => make.animationIR(),
        repair: () => make.animationIR(),
      }),
    )
    const result = await collect(
      pipelineWith(repos, llm, {
        flags: flagsOff({ animations: true }),
        validateAnimation: (_ir, _animation, context) => {
          expect(context.blocks.has(`${L}#b0`)).toBe(true)
          expect(context.blocks.has(`${C}#b1`)).toBe(false)
          return [
            {
              layer: 'animation',
              severity: 'error',
              code: 'animation-grounding',
              message: 'Animation evidence is outside the allowed context.',
            },
          ]
        },
      }).requestSection(L),
    )
    const record = result.of('item-ready')[0]!.record
    expect(record.animation).toBeUndefined()
    expect(record.validation.issues).toContainEqual(
      expect.objectContaining({
        code: 'animation-grounding',
        severity: 'warning',
      }),
    )
    expect(record.kind).toBe('graph')
    expect(llm.calls.filter((call) => call.role === 'repair')).toHaveLength(1)
    expect(record.usageTokens).toBe(330)
  })

  test('stores a grounded flow-order fallback when the animator throws', async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
        animator: () => {
          throw new Error('animator unavailable')
        },
      }),
    )
    const validateAnimation = vi.fn<
      NonNullable<PipelineDeps['validateAnimation']>
    >((ir, candidate, { blocks }) => {
      expect(blocks.has(`${L}#b0`)).toBe(true)
      expect(blocks.has(`${C}#b1`)).toBe(false)
      const result = validateCoreAnimation(GraphIR.parse(ir), candidate, {
        grounding: { blocks },
      })
      expect(result.ok).toBe(true)
      return result.issues
    })
    const result = await collect(
      pipelineWith(repos, llm, {
        flags: flagsOff({ animations: true }),
        validateAnimation,
      }).requestSection(L),
    )
    const record = result.of('item-ready')[0]!.record
    expect(record.animation).toEqual(
      defaultStoryboard(record.ir as GraphIR, 'p1'),
    )
    expect(record.animation).toBeDefined()
    expect(validateAnimation).toHaveBeenCalledOnce()
    expect(record.validation.issues).toContainEqual({
      layer: 'animation',
      severity: 'warning',
      code: 'animation-fallback',
      message:
        'Animator output was unusable; showed the graph in flow order instead.',
    })
    expect(record.validation.issues).toContainEqual(
      expect.objectContaining({ code: 'animation-failed' }),
    )
    expect(await repos.visuals.get(record.cacheKey)).toEqual(record)
    expect(llm.calls.map((c) => c.role)).toEqual([
      'planner',
      'extractor.graph',
      'animator',
    ])
  })

  test('keeps a valid animator animation and adds no fallback warning', async () => {
    const animation = make.animationIR()
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
        animator: () => animation,
      }),
    )
    const validateAnimation = vi.fn(() => [])
    const result = await collect(
      pipelineWith(await seededRepos(), llm, {
        flags: flagsOff({ animations: true }),
        validateAnimation,
      }).requestSection(L),
    )
    const record = result.of('item-ready')[0]!.record
    expect(record.animation).toEqual(animation)
    expect(validateAnimation).toHaveBeenCalledOnce()
    expect(record.validation.issues.map((i) => i.code)).not.toContain(
      'animation-fallback',
    )
    expect(llm.calls.map((c) => c.role)).toEqual([
      'planner',
      'extractor.graph',
      'animator',
    ])
  })

  test('falls back after one unusable repair, reusing the exact evidence whitelist', async () => {
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
        animator: () => make.animationIR(),
        repair: () => make.animationIR(),
      }),
    )
    const whitelists: unknown[] = []
    const result = await collect(
      pipelineWith(await seededRepos(), llm, {
        flags: flagsOff({ animations: true }),
        validateAnimation: (ir, candidate, { blocks }) => {
          whitelists.push(blocks)
          if (!candidate.steps[0]!.id.startsWith('storyboard-'))
            return [
              {
                layer: 'animation',
                severity: 'error',
                code: 'animation-grounding',
                message: 'Ungrounded narration.',
              },
            ]
          return validateCoreAnimation(GraphIR.parse(ir), candidate, {
            grounding: { blocks },
          }).issues
        },
      }).requestSection(L),
    )
    const record = result.of('item-ready')[0]!.record
    expect(record.animation?.steps[0]!.id).toBe('storyboard-1')
    expect(record.validation.issues).toContainEqual(
      expect.objectContaining({
        code: 'animation-fallback',
        severity: 'warning',
      }),
    )
    expect(whitelists).toHaveLength(3)
    expect(whitelists.every((blocks) => blocks === whitelists[0])).toBe(true)
    expect(llm.calls.filter((c) => c.role === 'repair')).toHaveLength(1)
  })

  test('keeps the static graph when fewer than three nodes can form a fallback', async () => {
    const graph = make.graphIR()
    const small = make.graphIR({
      nodes: graph.nodes.slice(0, 2),
      edges: graph.edges.slice(0, 1),
    })
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(small),
        animator: () => {
          throw new Error('animator unavailable')
        },
      }),
    )
    const validateAnimation = vi.fn(() => [])
    const result = await collect(
      pipelineWith(await seededRepos(), llm, {
        flags: flagsOff({ animations: true }),
        validateAnimation,
      }).requestSection(L),
    )
    const record = result.of('item-ready')[0]!.record
    expect(record.animation).toBeUndefined()
    expect(validateAnimation).not.toHaveBeenCalled()
    expect(record.validation.issues.map((i) => i.code)).toContain(
      'animation-failed',
    )
    expect(record.validation.issues.map((i) => i.code)).not.toContain(
      'animation-fallback',
    )
  })

  test('rejects a fallback that fails animation validation and preserves the original warning', async () => {
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
        animator: () => {
          throw new Error('animator unavailable')
        },
      }),
    )
    const validateAnimation = vi.fn(() => [
      {
        layer: 'animation' as const,
        severity: 'error' as const,
        code: 'animation-grounding',
        message: 'Evidence rejected.',
      },
    ])
    const result = await collect(
      pipelineWith(await seededRepos(), llm, {
        flags: flagsOff({ animations: true }),
        validateAnimation,
      }).requestSection(L),
    )
    const record = result.of('item-ready')[0]!.record
    expect(record.animation).toBeUndefined()
    expect(validateAnimation).toHaveBeenCalledOnce()
    expect(record.validation.issues.map((i) => i.code)).toContain(
      'animation-failed',
    )
    expect(record.validation.issues.map((i) => i.code)).not.toContain(
      'animation-fallback',
    )
  })

  test('keeps the static visual if the fallback validator itself throws', async () => {
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
        animator: () => {
          throw new Error('animator unavailable')
        },
      }),
    )
    const validateAnimation = vi.fn(() => {
      throw new Error('validator unavailable')
    })
    const result = await collect(
      pipelineWith(await seededRepos(), llm, {
        flags: flagsOff({ animations: true }),
        validateAnimation,
      }).requestSection(L),
    )
    expect(result.of('item-ready')[0]!.record.animation).toBeUndefined()
    expect(validateAnimation).toHaveBeenCalledOnce()
    expect(result.of('item-ready')[0]!.record.validation.issues).toContainEqual(
      expect.objectContaining({ code: 'animation-failed' }),
    )
  })

  test('keeps non-graph animator failures static', async () => {
    const llm = fakeLlm(
      byRole({
        planner: () => plan({ items: [make.planItem({ kind: 'sequence' })] }),
        'extractor.mermaid': () => make.sequenceIR(),
        animator: () => {
          throw new Error('animator unavailable')
        },
      }),
    )
    const validateAnimation = vi.fn(() => [])
    const result = await collect(
      pipelineWith(await seededRepos(), llm, {
        flags: flagsOff({ animations: true }),
        validateAnimation,
      }).requestSection(L),
    )
    const record = result.of('item-ready')[0]!.record
    expect(record.kind).toBe('sequence')
    expect(record.animation).toBeUndefined()
    expect(validateAnimation).not.toHaveBeenCalled()
    expect(record.validation.issues.map((i) => i.code)).not.toContain(
      'animation-fallback',
    )
  })

  test.each([
    [false, true],
    [true, false],
  ])(
    'does not animate with flag=%s and plan animate=%s',
    async (enabled, animate) => {
      const llm = fakeLlm(
        byRole({
          planner: () => plan({ items: [make.planItem({ animate })] }),
          'extractor.graph': () => make.graphSource(),
        }),
      )
      const validateAnimation = vi.fn(() => [])
      const result = await collect(
        pipelineWith(await seededRepos(), llm, {
          flags: flagsOff({ animations: enabled }),
          validateAnimation,
        }).requestSection(L),
      )
      expect(result.of('item-ready')[0]!.record.animation).toBeUndefined()
      expect(llm.calls.map((c) => c.role)).toEqual([
        'planner',
        'extractor.graph',
      ])
      expect(validateAnimation).not.toHaveBeenCalled()
    },
  )

  test('never requests animation for executed traces even when the plan asks', async () => {
    const llm = fakeLlm(
      byRole({
        planner: () =>
          plan({
            items: [
              make.planItem({
                kind: 'trace',
                codeBlockId: TRACE_CODE_ID,
                animate: true,
              }),
            ],
          }),
        translator: () => make.translation(),
      }),
    )
    const validateAnimation = vi.fn(() => [])
    const result = await collect(
      pipelineWith(await seededTraceRepos(), llm, {
        flags: flagsOff({ animations: true, tracer: true }),
        validateAnimation,
        traceRunner: { runTrace: async () => [make.scenarioTrace()] },
      }).requestSection(L),
    )
    expect(result.of('item-ready')[0]!.record.kind).toBe('trace')
    expect(result.of('item-ready')[0]!.record.animation).toBeUndefined()
    expect(llm.calls.map((c) => c.role)).toEqual(['planner', 'translator'])
    expect(validateAnimation).not.toHaveBeenCalled()
  })

  test.each(['aborted', 'plan-limit'] as const)(
    'does not substitute a fallback for %s',
    async (code) => {
      const repos = await seededRepos()
      const llm = fakeLlm(
        byRole({
          planner: () => plan(),
          'extractor.graph': () => make.graphSource(),
          animator: () => {
            throw new LlmError(code, 'stop')
          },
        }),
      )
      const validateAnimation = vi.fn(() => [])
      const result = await collect(
        pipelineWith(repos, llm, {
          flags: flagsOff({ animations: true }),
          validateAnimation,
        }).requestSection(L),
      )
      expect(result.of('item-ready')).toEqual([])
      expect(await repos.visuals.listByPlanItem('p1')).toEqual([])
      expect(validateAnimation).not.toHaveBeenCalled()
    },
  )

  test('does not build or store a fallback after cancellation during an animator failure', async () => {
    const repos = await seededRepos()
    const ref = {} as { job: SectionJob }
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
        animator: () => {
          ref.job.cancel()
          throw new Error('late failure')
        },
      }),
    )
    const validateAnimation = vi.fn(() => [])
    ref.job = pipelineWith(repos, llm, {
      flags: flagsOff({ animations: true }),
      validateAnimation,
    }).requestSection(L)
    const result = await collect(ref.job)
    expect(result.of('done')).toEqual([{ cancelled: true }])
    expect(result.of('item-ready')).toEqual([])
    expect(await repos.visuals.listByPlanItem('p1')).toEqual([])
    expect(validateAnimation).not.toHaveBeenCalled()
  })

  test('does not store a fallback when cancelled during its validation', async () => {
    const repos = await seededRepos()
    const ref = {} as { job: SectionJob }
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
        animator: () => {
          throw new Error('animator unavailable')
        },
      }),
    )
    ref.job = pipelineWith(repos, llm, {
      flags: flagsOff({ animations: true }),
      validateAnimation: () => {
        ref.job.cancel()
        return []
      },
    }).requestSection(L)
    const result = await collect(ref.job)
    expect(result.of('done')).toEqual([{ cancelled: true }])
    expect(result.of('item-ready')).toEqual([])
    expect(await repos.visuals.listByPlanItem('p1')).toEqual([])
  })

  test('animation repairs once with its validation report, revalidates with the same whitelist and accounts for the repair', async () => {
    const repos = await seededRepos()
    const original = make.animationIR()
    const repaired = {
      ...original,
      steps: original.steps.map((step) => ({
        ...step,
        narration: 'Corrected narration.',
      })),
    }
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
        animator: () => original,
        repair: () => repaired,
      }),
    )
    const whitelists: unknown[] = []
    const result = await collect(
      pipelineWith(repos, llm, {
        flags: flagsOff({ animations: true }),
        validateAnimation: (_ir, animation, { blocks }) => {
          whitelists.push(blocks)
          return animation.steps[0]!.narration === 'Corrected narration.'
            ? []
            : [
                {
                  layer: 'animation',
                  severity: 'error',
                  code: 'animation-grounding',
                  message: 'Evidence is missing.',
                },
              ]
        },
      }).requestSection(L),
    )
    const record = result.of('item-ready')[0]!.record
    expect(record.animation).toEqual(repaired)
    expect(whitelists).toHaveLength(2)
    expect(whitelists[0]).toBe(whitelists[1])
    const repair = llm.calls.find((call) => call.role === 'repair')!
    expect(repair.opts.schemaName).toBe('AnimationIR')
    for (const role of ['extractor.graph', 'animator', 'repair'] as const)
      expect(
        llm.calls.find((call) => call.role === role)!.opts.signal,
      ).toBeInstanceOf(AbortSignal)
    expect(repair.ctx.body).toContain('animation-grounding')
    expect(record).toMatchObject({
      usageTokens: 330,
      models: { repair: 'gpt-6.1-sol@medium' },
      promptVersions: { repair: '1.0.0' },
    })
  })
})

describe('limits', () => {
  test('the limiter runs at most n tasks and drops aborted queued ones', async () => {
    const lim = createLimiter(2)
    let running = 0
    let peak = 0
    const releases: (() => void)[] = []
    const task = () =>
      new Promise<void>((r) => {
        running++
        peak = Math.max(peak, running)
        releases.push(() => {
          running--
          r()
        })
      })
    const ac = new AbortController()
    const ps = [
      lim.run(task),
      lim.run(task),
      lim.run(task, ac.signal),
      lim.run(task),
    ]
    await Promise.resolve()
    expect([lim.active, lim.queued]).toEqual([2, 2])
    ac.abort()
    await expect(ps[2]).rejects.toMatchObject({ code: 'aborted' })
    while (releases.length) {
      releases.shift()!()
      await new Promise((r) => setTimeout(r, 0))
    }
    await Promise.all([ps[0], ps[1], ps[3]])
    expect(peak).toBe(2)
  })

  test('every item starts at once; items on the same concept model run one after another (ADR 0054)', async () => {
    const repos = await seededRepos()
    const log: string[] = []
    const gate = <T>(name: string, value: () => T) =>
      new Promise<T>((r) => {
        log.push(`start ${name}`)
        setTimeout(() => {
          log.push(`end ${name}`)
          r(value())
        }, 10)
      })
    const items = [
      make.planItem({ planItemId: 'a', newConceptModel: 'c1', animate: false }),
      make.planItem({
        planItemId: 'b',
        intent: 'A second view of the same model',
        priority: 2,
        newConceptModel: 'c1',
        animate: false,
      }),
      make.planItem({ planItemId: 'c', priority: 3, animate: false }),
    ]
    const llm = fakeLlm(
      byRole({
        planner: () => plan({ items }),
        'extractor.graph': () => gate('c', () => make.graphSource()),
      }),
    )
    const r = await collect(
      pipelineWith(repos, llm, {
        flags: flagsOff({ conceptModels: true }),
        conceptModels: ({ planItem }) =>
          gate(planItem.planItemId, () => ({
            kind: 'graph' as const,
            ir: make.graphIR(),
            report: make.validationReport(),
            promptVersions: {},
            models: {},
            usageTokens: 0,
          })),
      }).requestSection(L),
    )
    expect(
      r
        .of('item-ready')
        .map((e) => e.planItemId)
        .sort(),
    ).toEqual(['a', 'b', 'c'])
    // c does not wait for a; b waits for a because both patch c1.
    expect(log.indexOf('start c')).toBeLessThan(log.indexOf('end a'))
    expect(log.indexOf('start b')).toBeGreaterThan(log.indexOf('end a'))
  })

  test('at most 4 LLM requests are in flight', async () => {
    const repos = await seededRepos()
    let inFlight = 0
    let peak = 0
    const items = [1, 2, 3].map((n) =>
      make.planItem({
        planItemId: `p${n}`,
        priority: n as 1 | 2 | 3,
        animate: false,
      }),
    )
    const llm = fakeLlm(async (c) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return c.role === 'planner' ? plan({ items }) : make.graphSource()
    })
    const pipeline = pipelineWith(repos, llm, { maxLlmRequests: 1 })
    await collect(pipeline.requestSection(L))
    expect(peak).toBe(1)
  })
})

describe('shared jobs (ADR 0057)', () => {
  /** A promise with its resolver, to hold fake calls open. */
  const gate = () => {
    let open!: () => void
    const p = new Promise<void>((r) => (open = r))
    return { p, open }
  }
  /** Lets every pending promise chain of the in-memory pipeline settle. */
  const settle = async (n = 5) => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
  }
  const planners = (llm: { calls: Call[] }) =>
    llm.calls.filter((c) => c.role === 'planner').map((c) => c.opts.sectionId)
  const bg = { background: true, keepOthers: true } as const

  test('a foreground request joins a background job: one call per step, and late joiners replay the history in order', async () => {
    const repos = await seededRepos()
    const planner = gate()
    const extractor = gate()
    const planning = gate()
    const extracting = gate()
    const llm = fakeLlm(
      byRole({
        planner: async () => {
          planning.open()
          await planner.p
          return plan()
        },
        'extractor.graph': async () => {
          extracting.open()
          await extractor.p
          return make.graphSource()
        },
      }),
    )
    const pipeline = pipelineWith(repos, llm)
    const early = collect(pipeline.requestSection(L, bg))
    await planning.p
    const late = collect(pipeline.requestSection(L))
    planner.open()
    await extracting.p
    // Joins after `plan` and `queued` were emitted: they are replayed first, then live events follow.
    const later = collect(pipeline.requestSection(L, bg))
    extractor.open()
    const [re, rl, rr] = await Promise.all([early, late, later])
    expect(llm.calls.map((c) => c.role)).toEqual(['planner', 'extractor.graph'])
    expect(
      re.events.map((e) => e.type).filter((t) => t !== 'item-progress'),
    ).toEqual(['plan', 'item-ready', 'done'])
    expect(rl.events).toEqual(re.events)
    expect(rr.events).toEqual(re.events)
    expect(re.of('done')).toEqual([{ cancelled: false }])
  })

  test('cancelling the foreground handle releases it; the background holder keeps the job', async () => {
    const repos = await seededRepos()
    const planner = gate()
    const planning = gate()
    const llm = fakeLlm(
      byRole({
        planner: async () => {
          planning.open()
          await planner.p
          return plan()
        },
        'extractor.graph': () => make.graphSource(),
      }),
    )
    const pipeline = pipelineWith(repos, llm)
    const bgJob = pipeline.requestSection(L, bg)
    const rb = collect(bgJob)
    await planning.p
    const fgJob = pipeline.requestSection(L)
    const rf = collect(fgJob)
    fgJob.cancel()
    expect((await rf).events).toEqual([
      { type: 'done', payload: { cancelled: true } },
    ])
    expect(fgJob.cancelled).toBe(true)
    expect(llm.calls[0]!.opts.signal!.aborted).toBe(false)
    planner.open()
    const r = await rb
    expect(bgJob.cancelled).toBe(false)
    expect(r.of('item-ready')).toHaveLength(1)
    expect(r.of('done')).toEqual([{ cancelled: false }])
  })

  test('the last holder to cancel aborts the job', async () => {
    const repos = await seededRepos()
    const planner = gate()
    const planning = gate()
    const llm = fakeLlm(
      byRole({
        planner: async () => {
          planning.open()
          await planner.p
          return plan()
        },
      }),
    )
    const pipeline = pipelineWith(repos, llm)
    const a = pipeline.requestSection(L, bg)
    const b = pipeline.requestSection(L)
    const [ra, rb] = [collect(a), collect(b)]
    await planning.p
    b.cancel()
    expect(llm.calls[0]!.opts.signal!.aborted).toBe(false)
    a.cancel()
    expect(llm.calls[0]!.opts.signal!.aborted).toBe(true)
    planner.open()
    for (const r of await Promise.all([ra, rb])) {
      expect(r.of('plan')).toEqual([])
      expect(r.of('done')).toEqual([{ cancelled: true }])
    }
  })

  test('background requests do not take a section slot', async () => {
    const repos = await seededRepos()
    const planner = gate()
    const both = gate()
    const llm = fakeLlm(
      byRole({
        planner: async () => {
          if (planners(llm).length === 2) both.open()
          await planner.p
          return plan({ needsVisual: false, items: [] })
        },
      }),
    )
    const pipeline = pipelineWith(repos, llm, { maxSections: 1 })
    const jobs = [
      collect(pipeline.requestSection(C, bg)),
      collect(pipeline.requestSection(L)),
    ]
    await both.p
    expect(planners(llm).sort()).toEqual([L, C].sort())
    planner.open()
    await Promise.all(jobs)
  })

  test('a reader job left to the run alone gives back its section slot', async () => {
    const repos = await seededRepos()
    const planner = gate()
    const llm = fakeLlm(
      byRole({
        planner: async (c) => {
          if (c.opts.sectionId === L) await planner.p
          return plan({ needsVisual: false, items: [] })
        },
      }),
    )
    const pipeline = pipelineWith(repos, llm, { maxSections: 1 })
    const reader = collect(pipeline.requestSection(L))
    const run = collect(pipeline.requestSection(L, bg))
    await settle()
    // The reader moves on: L keeps running for the run, and C does not wait for L's slot.
    const next = await collect(pipeline.requestSection(C))
    expect(next.of('no-visual')).toHaveLength(1)
    expect((await reader).of('done')).toEqual([{ cancelled: true }])
    planner.open()
    expect((await run).of('done')).toEqual([{ cancelled: false }])
    expect(planners(llm)).toEqual([L, C])
  })

  test('foreground calls start while background calls hold every background slot', async () => {
    const repos = await seededRepos()
    const planner = gate()
    const llm = fakeLlm(
      byRole({
        planner: async (c) => {
          if (c.opts.sectionId === C) await planner.p
          return plan({ needsVisual: false, items: [] })
        },
      }),
    )
    const pipeline = pipelineWith(repos, llm, { maxBackgroundLlmRequests: 1 })
    const held = collect(pipeline.requestSection(C, bg))
    // C's call must hold the one background slot before the second section asks for it.
    await settle()
    expect(planners(llm)).toEqual([C])
    const queued = collect(pipeline.requestSection(CHAPTER_ID, bg))
    await settle()
    expect(planners(llm)).toEqual([C])
    // The reader's request is not queued behind the run's.
    await collect(pipeline.requestSection(L))
    expect(planners(llm)).toEqual([C, L])
    planner.open()
    await Promise.all([held, queued])
    expect(planners(llm)).toEqual([C, L, CHAPTER_ID])
  })

  test('a foreground request joining a background job promotes its queued calls', async () => {
    const repos = await seededRepos()
    const planner = gate()
    const llm = fakeLlm(
      byRole({
        planner: async (c) => {
          if (c.opts.sectionId === C) await planner.p
          return plan({ needsVisual: false, items: [] })
        },
      }),
    )
    const pipeline = pipelineWith(repos, llm, { maxBackgroundLlmRequests: 1 })
    const held = collect(pipeline.requestSection(C, bg))
    await settle()
    expect(planners(llm)).toEqual([C])
    const run = collect(pipeline.requestSection(L, bg))
    await settle()
    expect(planners(llm)).toEqual([C]) // L's planner call waits for a background slot
    const reader = await collect(pipeline.requestSection(L))
    expect(planners(llm)).toEqual([C, L])
    expect(reader.of('no-visual')).toHaveLength(1)
    planner.open()
    await Promise.all([held, run])
    expect(planners(llm)).toEqual([C, L])
  })

  test('force, instruction and selection requests never join', async () => {
    const cases: ((p: ReturnType<typeof pipelineWith>) => SectionJob)[] = [
      (p) => p.requestSection(L, { force: true, keepOthers: true }),
      (p) =>
        p.requestSection(L, { instruction: 'Use a ring', keepOthers: true }),
      (p) =>
        p.requestSelection(
          { parentSectionId: L, blockIds: [`${L}#b0`, `${L}#b1`] },
          { keepOthers: true },
        ),
    ]
    for (const other of cases) {
      const repos = await seededRepos()
      const planner = gate()
      const planning = gate()
      const llm = fakeLlm(
        byRole({
          planner: async () => {
            if (planners(llm).length === 2) planning.open()
            await planner.p
            return plan({ needsVisual: false, items: [] })
          },
        }),
      )
      const pipeline = pipelineWith(repos, llm)
      const jobs = [
        collect(pipeline.requestSection(L, bg)),
        collect(other(pipeline)),
      ]
      await planning.p
      expect(planners(llm)).toHaveLength(2)
      planner.open()
      await Promise.all(jobs)
    }
  })

  test('a foreground request for another section cancels the earlier foreground job, not the background one', async () => {
    const repos = await seededRepos()
    const planner = gate()
    const planning = gate()
    const llm = fakeLlm(
      byRole({
        planner: async () => {
          if (planners(llm).length === 2) planning.open()
          await planner.p
          return plan({ needsVisual: false, items: [] })
        },
      }),
    )
    const pipeline = pipelineWith(repos, llm)
    const run = collect(pipeline.requestSection(C, bg))
    const first = collect(pipeline.requestSection(L))
    await planning.p
    const next = collect(pipeline.requestSection(CHAPTER_ID))
    planner.open()
    const [rr, rf, rn] = await Promise.all([run, first, next])
    expect(rf.of('done')).toEqual([{ cancelled: true }])
    expect(rr.of('done')).toEqual([{ cancelled: false }])
    expect(rr.of('no-visual')).toHaveLength(1)
    expect(rn.of('done')).toEqual([{ cancelled: false }])
  })

  test('item-failed and error carry the plan-limit reset time', async () => {
    const limit = () =>
      new LlmError('plan-limit', 'plan limit reached', {
        retryAfterMs: 60_000,
      })
    const planFails = await collect(
      pipelineWith(
        await seededRepos(),
        fakeLlm(
          byRole({
            planner: () => {
              throw limit()
            },
          }),
        ),
      ).requestSection(L, bg),
    )
    expect(planFails.of('error')).toEqual([
      {
        code: 'plan-limit',
        message: 'plan limit reached',
        retryAfterMs: 60_000,
      },
    ])
    const itemFails = await collect(
      pipelineWith(
        await seededRepos(),
        fakeLlm(
          byRole({
            planner: () => plan(),
            'extractor.graph': () => {
              throw limit()
            },
          }),
        ),
      ).requestSection(L),
    )
    expect(itemFails.of('item-failed')).toEqual([
      {
        planItemId: 'p1',
        code: 'plan-limit',
        message: 'plan limit reached',
        retryAfterMs: 60_000,
      },
    ])
  })
})

describe('sectionCacheStatus and cachedSection (ADR 0064)', () => {
  const drawing = () =>
    fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
      }),
    )
  const versions = (over: Partial<Record<Call['role'], string>>) => ({
    get: (role: Call['role']) => ({
      version: over[role] ?? '1.0.0',
      budgetTokens: 12_000,
    }),
  })

  test('reports cached, no-visual and missing sections with the current-key plan and visuals', async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(
      byRole({
        planner: (c) =>
          c.opts.sectionId === CHAPTER_ID
            ? plan({ needsVisual: false, reason: 'Intro.', items: [] })
            : plan(),
        'extractor.graph': () => make.graphSource(),
      }),
    )
    const pipeline = pipelineWith(repos, llm)
    const drawn = await collect(pipeline.requestSection(L))
    await collect(pipeline.requestSection(CHAPTER_ID))
    const status = await pipeline.sectionCacheStatus([L, CHAPTER_ID, C, 'nope'])
    expect(status.get(L)).toMatchObject({
      state: 'cached',
      sectionId: L,
      plan: drawn.of('plan')[0]!.record,
      visuals: [drawn.of('item-ready')[0]!.record],
    })
    expect(status.get(CHAPTER_ID)).toMatchObject({ state: 'no-visual' })
    expect(status.get(C)).toMatchObject({ state: 'missing', visuals: [] })
    expect(status.get('nope')).toEqual({ state: 'missing', visuals: [] })
  })

  test('stale records (another prompt version or flag set) are not current; a missing visual is partial', async () => {
    const repos = await seededRepos()
    await collect(pipelineWith(repos, drawing()).requestSection(L))
    const none = fakeLlm(() => {
      throw new Error('no model call expected')
    })
    const planner2 = pipelineWith(repos, none, {
      prompts: versions({ planner: '2.0.0' }),
    })
    expect((await planner2.sectionCacheStatus([L])).get(L)).toEqual({
      state: 'missing',
      sectionId: L,
      visuals: [],
    })
    const extractor2 = pipelineWith(repos, none, {
      prompts: versions({ 'extractor.graph': '2.0.0' }),
    })
    const partial = (await extractor2.sectionCacheStatus([L])).get(L)!
    expect(partial.state).toBe('partial')
    expect(partial.plan).toBeDefined()
    expect(partial.visuals).toEqual([])
    const templatesOn = pipelineWith(repos, none, {
      flags: flagsOff({ templates: true }),
    })
    expect((await templatesOn.sectionCacheStatus([L])).get(L)!.state).toBe(
      'missing',
    )
    expect(none.calls).toHaveLength(0)
  })

  test('a visual stored under the escalated-route key still counts (ADR 0060)', async () => {
    const repos = await seededRepos()
    const first = await collect(
      pipelineWith(repos, drawing()).requestSection(L),
    )
    const planRecord = first.of('plan')[0]!.record
    const record = first.of('item-ready')[0]!.record
    const deep = resolveRoute(DEFAULT_MODELS, 'extractor.graph', true).chain[0]!
    const legacyKey = await visualKey({
      planKey: planRecord.cacheKey,
      planItem: planRecord.plan.items[0]!,
      extractor: { promptVersion: '1.0.0', ...deep },
      compilerVersion: COMPILER_VERSION,
    })
    await repos.visuals.delete(record.cacheKey)
    await repos.visuals.put({ ...record, cacheKey: legacyKey })
    const status = await pipelineWith(repos, drawing()).sectionCacheStatus([L])
    expect(status.get(L)).toMatchObject({
      state: 'cached',
      visuals: [{ cacheKey: legacyKey }],
    })
  })

  test('resolves merged sections and batches its reads for many sections', async () => {
    const repos = await seededRepos()
    await collect(pipelineWith(repos, drawing()).requestSection(L))
    await repos.sections.put({
      ...(await repos.sections.get(C))!,
      mergedInto: L,
    })
    const pipeline = pipelineWith(repos, drawing())
    const spies = {
      planGet: vi.spyOn(repos.plans, 'get'),
      visualGet: vi.spyOn(repos.visuals, 'get'),
      planBulk: vi.spyOn(repos.plans, 'bulkGet'),
      visualBulk: vi.spyOn(repos.visuals, 'bulkGet'),
    }
    const ids = [
      C,
      L,
      CHAPTER_ID,
      ...Array.from({ length: 50 }, (_, i) => `x${i}`),
    ]
    const status = await pipeline.sectionCacheStatus(ids)
    expect(status.get(C)).toMatchObject({ state: 'cached', sectionId: L })
    expect(status.get(L)!.state).toBe('cached')
    expect(spies.planGet).not.toHaveBeenCalled()
    expect(spies.visualGet).not.toHaveBeenCalled()
    expect(spies.planBulk).toHaveBeenCalledOnce()
    expect(spies.visualBulk).toHaveBeenCalledOnce()
  })

  test('cachedSection returns the current plan with its default, regenerated and kind-override visuals, never stale ones', async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
        'extractor.timeline': () => make.timelineIR(),
      }),
    )
    const pipeline = pipelineWith(repos, llm)
    const base = await collect(pipeline.requestSection(L))
    const regenerated = await collect(
      pipeline.requestSection(L, { instruction: 'Fewer nodes' }),
    )
    const overridden = await collect(
      pipeline.requestSection(L, { kindOverride: 'timeline' }),
    )
    const stale = {
      ...base.of('item-ready')[0]!.record,
      cacheKey: 'stale-key',
      createdAt: 1,
    }
    await repos.visuals.put(stale)
    const r = await pipeline.cachedSection(L)
    expect(r.status.state).toBe('cached')
    expect(r.status.plan).toEqual(base.of('plan')[0]!.record)
    expect(r.records.map((x) => x.cacheKey).sort()).toEqual(
      [
        base.of('item-ready')[0]!.record.cacheKey,
        regenerated.of('item-ready')[0]!.record.cacheKey,
        overridden.of('item-ready')[0]!.record.cacheKey,
      ].sort(),
    )
    // Nothing is current once the plan's key changes.
    const other = pipelineWith(repos, llm, {
      prompts: versions({ planner: '2.0.0' }),
    })
    expect(await other.cachedSection(L)).toEqual({
      status: { state: 'missing', sectionId: L, visuals: [] },
      records: [],
    })
  })
})

describe('cachedSection kind overrides (ADR 0064)', () => {
  test('a kind-override record stored under another kind (trace that fell back to timeline) is still current', async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
      }),
    )
    const pipeline = pipelineWith(repos, llm)
    const base = await collect(pipeline.requestSection(L))
    const planRecord = base.of('plan')[0]!.record
    const drawn = base.of('item-ready')[0]!.record
    const item = planRecord.plan.items[0]!
    // A trace override whose route fell back to a timeline: keyed by the trace request, stored as timeline.
    const translator = resolveRoute(DEFAULT_MODELS, 'translator').chain[0]!
    const fallback = {
      ...drawn,
      cacheKey: await visualKey({
        planKey: planRecord.cacheKey,
        planItem: overrideKind(item, 'trace'),
        extractor: { promptVersion: '1.0.0', ...translator },
        compilerVersion: COMPILER_VERSION,
      }),
      kind: 'timeline' as const,
      ir: make.timelineIR(),
      createdAt: drawn.createdAt + 1,
    }
    await repos.visuals.put(fallback)
    const r = await pipeline.cachedSection(L)
    expect(r.records.map((x) => x.cacheKey).sort()).toEqual(
      [drawn.cacheKey, fallback.cacheKey].sort(),
    )
  })
})

describe('index wait (ADR 0064)', () => {
  test('a cancelled job stops waiting for indexNow at once instead of after INDEX_WAIT_MS', async () => {
    const repos = await seededRepos()
    await repos.sectionIndex.delete(L)
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': () => make.graphSource(),
      }),
    )
    const asked: string[] = []
    const pipeline = pipelineWith(repos, llm, {
      maxSections: 1,
      concepts: { indexNow: (id) => (asked.push(id), new Promise(() => {})) },
    })
    const job = pipeline.requestSection(L)
    const r = collect(job)
    await vi.waitFor(() => expect(asked).toEqual([L]))
    const started = Date.now()
    job.cancel()
    await r
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(llm.calls).toHaveLength(0)
    // Its section slot is free again: the next foreground section plans.
    const next = await collect(pipeline.requestSection(C))
    expect(next.of('plan')).toHaveLength(1)
    expect(llm.calls[0]!.role).toBe('planner')
  })
})

describe('stale fallback (ADR 0065)', () => {
  const versions = (over: Partial<Record<Call['role'], string>>) => ({
    get: (role: Call['role']) => ({
      version: over[role] ?? '1.0.0',
      budgetTokens: 12_000,
    }),
  })
  const none = () =>
    fakeLlm(() => {
      throw new Error('no model call expected')
    })
  const twoItems = () =>
    plan({
      items: [
        make.planItem(),
        make.planItem({ planItemId: 'p2', intent: 'Second', priority: 2 }),
      ],
    })
  const drawing = (planned = () => plan()) =>
    fakeLlm(
      byRole({
        planner: planned,
        'extractor.graph': () => make.graphSource(),
      }),
    )
  /** Draws L at t = 100 and returns its plan and visuals. */
  async function drawn(planned?: () => VisualPlan) {
    const repos = await seededRepos()
    const r = await collect(
      pipelineWith(repos, drawing(planned), { now: () => 100 }).requestSection(
        L,
      ),
    )
    return {
      repos,
      planRecord: r.of('plan')[0]!.record,
      visuals: r.of('item-ready').map((e) => e.record),
    }
  }

  test('a section with no current plan falls back to the newest older plan and its newest visuals, marked stale in memory only', async () => {
    const { repos, planRecord, visuals } = await drawn()
    const v1 = visuals[0]!
    // An even older plan whose p1 meant something else, with its own visual.
    await repos.plans.put({
      ...planRecord,
      cacheKey: 'older-plan',
      createdAt: 50,
      plan: plan({ items: [make.planItem({ intent: 'Old intent' })] }),
    })
    await repos.visuals.put({ ...v1, cacheKey: 'older-visual', createdAt: 60 })
    // A regeneration of p1 after the plan: the newest visual for p1 wins.
    await repos.visuals.put({
      ...v1,
      cacheKey: 'regenerated',
      instruction: 'Fewer nodes',
      createdAt: 150,
    })
    // An item the newest plan does not have.
    await repos.visuals.put({
      ...v1,
      cacheKey: 'unknown-item',
      planItemId: 'p9',
      createdAt: 200,
    })
    const llm = none()
    const planner2 = pipelineWith(repos, llm, {
      prompts: versions({ planner: '2.0.0' }),
    })
    const r = await planner2.cachedSection(L, { stale: true })
    expect(r.status.state).toBe('missing')
    expect(r.records).toEqual([])
    expect(r.stale!.plan.cacheKey).toBe(planRecord.cacheKey)
    expect(r.stale!.records.map((x) => [x.cacheKey, x.stale])).toEqual([
      ['regenerated', true],
    ])
    // Never written back.
    expect((await repos.visuals.get('regenerated'))!.stale).toBe(false)
    // Without the option, nothing changes from ADR 0064.
    expect(await planner2.cachedSection(L)).not.toHaveProperty('stale')
    expect(llm.calls).toHaveLength(0)
  })

  test('items whose kind is now off are left out of the fallback', async () => {
    const { repos, planRecord, visuals } = await drawn()
    await repos.plans.put({
      ...planRecord,
      cacheKey: 'with-trace',
      createdAt: 150,
      plan: plan({
        items: [
          make.planItem(),
          make.planItem({
            planItemId: 'p2',
            kind: 'trace',
            codeBlockId: TRACE_CODE_ID,
          }),
        ],
      }),
    })
    await repos.visuals.put({ ...visuals[0]!, cacheKey: 'g', createdAt: 160 })
    await repos.visuals.put({
      ...visuals[0]!,
      cacheKey: 't',
      planItemId: 'p2',
      kind: 'trace',
      ir: null,
      traceKey: 'trace-key',
      createdAt: 160,
    })
    const r = await pipelineWith(repos, none(), {
      prompts: versions({ planner: '2.0.0' }),
    }).cachedSection(L, { stale: true })
    expect(r.stale!.records.map((x) => x.cacheKey)).toEqual(['g'])
  })

  test('no fallback when the newest older plan has nothing to draw: an even older plan is never used', async () => {
    const { repos, planRecord } = await drawn()
    await repos.plans.put({
      ...planRecord,
      cacheKey: 'newest-plan',
      createdAt: 300,
      plan: plan({ needsVisual: false, reason: 'Intro.', items: [] }),
    })
    const r = await pipelineWith(repos, none(), {
      prompts: versions({ planner: '2.0.0' }),
    }).cachedSection(L, { stale: true })
    expect(r.status.state).toBe('missing')
    expect(r).not.toHaveProperty('stale')
  })

  test('a fully cached current plan never mixes in stale items', async () => {
    const { repos, visuals } = await drawn()
    const v1 = visuals[0]!
    await repos.visuals.put({ ...v1, cacheKey: 'old-p1', createdAt: 150 })
    await repos.visuals.put({
      ...v1,
      cacheKey: 'old-p2',
      planItemId: 'p2',
      createdAt: 150,
    })
    const r = await pipelineWith(repos, none(), {
      now: () => 100,
    }).cachedSection(L, { stale: true })
    expect(r.status.state).toBe('cached')
    expect(r.records.map((x) => x.cacheKey)).toEqual([v1.cacheKey])
    expect(r).not.toHaveProperty('stale')
  })

  test('partial: only the items without a current visual fall back, to records made from the current plan', async () => {
    const { repos, planRecord, visuals } = await drawn(twoItems)
    const [v1, v2] = visuals.sort((a, b) =>
      a.planItemId.localeCompare(b.planItemId),
    )
    // p2's visual is now under an older key (e.g. an older extractor version).
    await repos.visuals.delete(v2!.cacheKey)
    await repos.visuals.put({ ...v2!, cacheKey: 'old-p2', createdAt: 110 })
    // Made before the current plan: another plan's p2.
    await repos.visuals.put({ ...v2!, cacheKey: 'before-plan', createdAt: 90 })
    // A later plan of the section (another flag set) owns everything made after it.
    await repos.plans.put({
      ...planRecord,
      cacheKey: 'later-plan',
      createdAt: 120,
    })
    await repos.visuals.put({ ...v2!, cacheKey: 'after-later', createdAt: 130 })
    // An older-key record of p1 never shows next to p1's current visual.
    await repos.visuals.put({ ...v1!, cacheKey: 'old-p1', createdAt: 115 })
    const r = await pipelineWith(repos, none()).cachedSection(L, {
      stale: true,
    })
    expect(r.status.state).toBe('partial')
    expect(r.records.map((x) => x.cacheKey)).toEqual([v1!.cacheKey])
    expect(r.stale!.plan.cacheKey).toBe(planRecord.cacheKey)
    expect(r.stale!.records.map((x) => [x.cacheKey, x.stale])).toEqual([
      ['old-p2', true],
    ])
    expect((await repos.visuals.get('old-p2'))!.stale).toBe(false)
  })

  test('a failing fallback read never hides the current records', async () => {
    const { repos, visuals } = await drawn(twoItems)
    const [v1, v2] = visuals.sort((a, b) =>
      a.planItemId.localeCompare(b.planItemId),
    )
    await repos.visuals.delete(v2!.cacheKey)
    await repos.visuals.put({ ...v2!, cacheKey: 'old-p2', createdAt: 110 })
    vi.spyOn(repos.plans, 'listBySection').mockRejectedValue(
      new Error('disk is busy'),
    )
    const partial = await pipelineWith(repos, none()).cachedSection(L, {
      stale: true,
    })
    expect(partial.status.state).toBe('partial')
    expect(partial.records.map((x) => x.cacheKey)).toEqual([v1!.cacheKey])
    expect(partial).not.toHaveProperty('stale')
    const missing = await pipelineWith(repos, none(), {
      prompts: versions({ planner: '2.0.0' }),
    }).cachedSection(L, { stale: true })
    expect(missing).toEqual({
      status: { state: 'missing', sectionId: L, visuals: [] },
      records: [],
    })
  })

  test('partial after an extractor version change: the whole plan falls back per item', async () => {
    const { repos, planRecord, visuals } = await drawn()
    const r = await pipelineWith(repos, none(), {
      prompts: versions({ 'extractor.graph': '2.0.0' }),
    }).cachedSection(L, { stale: true })
    expect(r.status.state).toBe('partial')
    expect(r.records).toEqual([])
    expect(r.stale).toEqual({
      plan: planRecord,
      records: [{ ...visuals[0]!, stale: true }],
    })
  })
})
