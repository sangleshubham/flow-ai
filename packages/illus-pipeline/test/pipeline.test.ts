import { LlmError, animationTargets } from '@illus/core'
import type {
  GraphIR,
  LlmCall,
  TemplateRegistry,
  VisualPlan,
} from '@illus/core'
import { make } from '@illus/core/testing'
import { describe, expect, test } from 'vitest'

import { createLimiter, reportBlock } from '../src/index.ts'
import type { ReviewHook, SectionJob } from '../src/index.ts'
import {
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

  test('a structural error (isolated nodes) is retried with the validator report, not failed outright', async () => {
    const repos = await seededRepos()
    const good = make.graphSource()
    const isolated = make.graphSource({ ...make.graphIR(), edges: [] })
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': (c) => (c.ctx.body.includes('<validator_report') ? good : isolated),
      }),
    )
    const r = await collect(pipelineWith(repos, llm).requestSection(L))
    const ex = llm.calls.filter((c) => c.role === 'extractor.graph')
    expect(ex).toHaveLength(2)
    expect(ex[1]!.ctx.body).toContain('isolated-nodes')
    expect(r.of('item-ready')[0]!.record).toMatchObject({ validation: { retried: true, escalated: false } })
  })

  test('graph source lines that do not parse are dropped, counted and quoted back on a retry (ADR 0049)', async () => {
    const repos = await seededRepos()
    const good = make.graphSource()
    const broken = { source: `${good.source}\nGhost @b99 "nothing here at all"\nLeader - Log @b0 "The leader accepts client requests"\nA [icon: server @b0 "x y z"` }
    const llm = fakeLlm(
      byRole({
        planner: () => plan(),
        'extractor.graph': (c) => (c.ctx.body.includes('<validator_report') ? good : broken),
      }),
    )
    const r = await collect(pipelineWith(repos, llm).requestSection(L))
    const ex = llm.calls.filter((c) => c.role === 'extractor.graph')
    // 3 of 11 statements dropped (27%): kept without a retry, the drops recorded in the report.
    expect(ex).toHaveLength(1)
    const v = r.of('item-ready')[0]!.record.validation
    expect(v).toMatchObject({ ok: true, retried: false, counts: { dropped: 3, total: 11 } })
    expect(v.issues.filter((i) => i.code.startsWith('dsl-')).map((i) => i.code)).toEqual(['dsl-unknown-block', 'dsl-bad-connector', 'dsl-syntax'])
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
