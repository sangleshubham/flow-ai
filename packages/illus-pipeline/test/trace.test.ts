import { LlmError, resolveFlags } from '@illus/core'
import type { Translation } from '@illus/core'
import { make } from '@illus/core/testing'
import { describe, expect, test } from 'vitest'

import { SECTION_COMMIT_ID as C, SECTION_LEADERS_ID as L, TRACE_CODE_ID, collect, fakeLlm, pipelineWith, seededRepos, seededTraceRepos } from './helpers.ts'

const item = make.planItem({ kind: 'trace', codeBlockId: TRACE_CODE_ID, animate: false })
const plan = make.visualPlan({ items: [item] })
const flags = resolveFlags({ tracer: true, templates: true, animations: true })
const fallback = (translation: Translation, route = 'simulated-template', repairs = 0) =>
  Object.assign(new Error('timeout <traceback>'), { code: 'trace-fallback', route, reason: 'timeout <traceback>', translation, repairs })

describe('trace execution and fallback routing', () => {
  test('repairs at most twice through the accounted LLM, and stores repaired execution metadata', async () => {
    const repos = await seededTraceRepos()
    let fixes = 0
    const llm = fakeLlm(({ role }) => {
      if (role === 'planner') return plan
      if (role === 'translator') return make.translation()
      if (role === 'trace-fixer') return make.translation({ python: `fixed${++fixes}` })
      throw new Error(`unexpected ${role}`)
    })
    const runs: Translation[] = []
    const result = await collect(pipelineWith(repos, llm, {
      flags,
      traceRunner: { runTrace: async ({ translation }, opts) => {
        expect(opts?.signal).toBeInstanceOf(AbortSignal)
        runs.push(translation)
        if (runs.length < 3) throw fallback(translation)
        return [make.scenarioTrace({ trace: make.trace({ python: translation.python }) })]
      } },
    }).requestSection(L))
    expect(result.of('item-failed')).toEqual([])
    const record = result.of('item-ready')[0]!.record
    expect(record.usageTokens).toBe(330)
    expect(record.models).toHaveProperty('trace-fixer', 'gpt-6.1-sol@medium')
    const stored = await repos.traces.get(record.traceKey!)
    expect(stored).toMatchObject({ mode: 'executed', translation: { python: 'fixed2' }, models: { 'trace-fixer': 'gpt-6.1-sol' }, efforts: { 'trace-fixer': 'medium' } })
    expect(llm.calls.filter((c) => c.role === 'trace-fixer')).toHaveLength(2)
    expect(llm.calls[2]!.ctx.body).toContain('timeout &lt;traceback>')
    expect(llm.calls[1]!.ctx.body).toContain(`<trace_source block_id="${TRACE_CODE_ID}"`)
    expect(llm.calls[1]!.ctx.body).toContain('func (l *Log) advanceCommit')
  })

  test('persistent failures become a grounded animated template explicitly marked simulated', async () => {
    const repos = await seededTraceRepos()
    const translation = make.translation({ vizHints: [{ variable: 'items', template: 'array' }] })
    const llm = fakeLlm(({ role }) => {
      if (role === 'planner') return plan
      if (role === 'translator' || role === 'trace-fixer') return translation
      if (role === 'extractor.template') return make.templateIR({ evidence: make.templateIR().evidence.map((e) => ({ ...e, evidence: { blockId: `${L}#b0`, quote: 'The leader accepts client requests and appends each command to its log as a new entry.' } })) })
      if (role === 'animator') return make.animationIR()
      throw new Error(`unexpected ${role}`)
    })
    const pipeline = pipelineWith(repos, llm, { flags, traceRunner: { runTrace: async () => { throw fallback(translation) } } })
    const result = await collect(pipeline.requestSection(L))
    expect(result.of('item-failed')).toEqual([])
    const record = result.of('item-ready')[0]!.record
    expect(record).toMatchObject({ kind: 'template', spec: null, animation: make.animationIR(), usageTokens: 550 })
    expect(record.traceKey).toBeUndefined()
    expect(record.validation.issues).toContainEqual(expect.objectContaining({ code: 'trace-simulated', severity: 'warning' }))
    expect(await repos.traces.listByCodeBlock(item.codeBlockId!)).toEqual([])
    expect(llm.calls.map((c) => c.role)).toEqual(['planner', 'translator', 'trace-fixer', 'trace-fixer', 'extractor.template', 'animator'])
    const second = await collect(pipeline.requestSection(L))
    expect(second.of('item-ready')[0]).toMatchObject({ fromCache: true, record })
    expect(llm.calls).toHaveLength(6)
  })

  test('nontraceable concurrency extracts a validated timeline; unsupported code shows its reason without execution', async () => {
    for (const reason of ['Concurrent threads require scheduling.', 'Network I/O is unsupported.']) {
      const repos = await seededTraceRepos()
      const llm = fakeLlm(({ role }) => {
        if (role === 'planner') return plan
        if (role === 'translator') return make.translation({ traceable: false, reason })
        if (role === 'extractor.timeline') return make.timelineIR()
        throw new Error(`unexpected ${role}`)
      })
      let runs = 0
      const result = await collect(pipelineWith(repos, llm, { flags, traceRunner: { runTrace: async () => { runs++; return [] } } }).requestSection(L))
      expect(runs).toBe(0)
      expect(await repos.traces.listByCodeBlock(item.codeBlockId!)).toEqual([])
      if (reason.startsWith('Concurrent')) {
        expect(result.of('item-failed')).toEqual([])
        expect(result.of('item-ready')[0]!.record).toMatchObject({ kind: 'timeline', ir: { simulated: true }, spec: null })
        expect(result.of('item-ready')[0]!.record.validation.issues).toContainEqual(expect.objectContaining({ code: 'trace-simulated', message: reason }))
      } else expect(result.of('item-failed')[0]).toMatchObject({ code: 'trace-unsupported', message: reason })
    }
  })

  test('honors the runner repair count and flags, and does not mask unrelated runner failures', async () => {
    for (const failure of [fallback(make.translation(), 'simulated-template', 2), new Error('worker asset missing')]) {
      const repos = await seededTraceRepos()
      const llm = fakeLlm(({ role }) => role === 'planner' ? plan : make.translation())
      const result = await collect(pipelineWith(repos, llm, {
        flags: resolveFlags({ tracer: true }), traceRunner: { runTrace: async () => { throw failure } },
      }).requestSection(L))
      expect(llm.calls.map((c) => c.role)).toEqual(['planner', 'translator'])
      expect(result.of('item-ready')).toEqual([])
      expect(result.of('item-failed')[0]).toMatchObject({ code: failure.message === 'worker asset missing' ? 'internal' : 'trace-fallback-unavailable' })
    }
  })

  test('navigation aborts the worker signal and prevents any new fixer request', async () => {
    const repos = await seededTraceRepos()
    let started!: () => void
    const running = new Promise<void>((r) => { started = r })
    let release!: () => void
    const wait = new Promise<void>((r) => { release = r })
    const llm = fakeLlm(({ role }) => role === 'planner' ? plan : make.translation())
    let signal: AbortSignal | undefined
    const job = pipelineWith(repos, llm, { flags, traceRunner: { runTrace: async ({ translation }, opts) => {
      signal = opts?.signal
      started()
      await wait
      if (signal?.aborted) throw new LlmError('aborted', 'worker aborted')
      throw fallback(translation)
    } } }).requestSection(L)
    const result = collect(job)
    await running
    job.cancel()
    release()
    expect((await result).of('done')).toEqual([{ cancelled: true }])
    expect(signal?.aborted).toBe(true)
    expect(llm.calls.map((c) => c.role)).toEqual(['planner', 'translator'])
  })

  test('a selected code block outside the context whitelist is rejected before translating or running it', async () => {
    const repos = await seededRepos()
    const llm = fakeLlm(() => make.visualPlan({ items: [{ ...item, codeBlockId: `${C}#b1` }] }))
    const result = await collect(pipelineWith(repos, llm, { flags, traceRunner: { runTrace: async () => { throw new Error('must not run') } } }).requestSection(L))
    expect(result.of('item-failed')[0]).toMatchObject({ code: 'trace-code-outside-context' })
    expect(llm.calls.map((c) => c.role)).toEqual(['planner'])
  })

  test('plan-limit in the fixer stops requests and does not invent a fallback', async () => {
    const repos = await seededTraceRepos()
    const llm = fakeLlm(({ role }) => {
      if (role === 'planner') return plan
      if (role === 'translator') return make.translation()
      throw new LlmError('plan-limit', 'Five-hour limit reached')
    })
    const result = await collect(pipelineWith(repos, llm, { flags, traceRunner: { runTrace: async ({ translation }) => { throw fallback(translation) } } }).requestSection(L))
    expect(result.of('item-failed')[0]).toMatchObject({ code: 'plan-limit' })
    expect(result.of('item-ready')).toEqual([])
    expect(llm.calls.map((c) => c.role)).toEqual(['planner', 'translator', 'trace-fixer'])
  })

  test('empty/error worker responses never enter the executed cache', async () => {
    for (const scenarios of [[], [make.scenarioTrace({ trace: make.trace({ error: 'unhandled exception' }) })]]) {
      const repos = await seededTraceRepos()
      const llm = fakeLlm(({ role }) => role === 'planner' ? plan : make.translation())
      const result = await collect(pipelineWith(repos, llm, { flags, traceRunner: { runTrace: async () => scenarios } }).requestSection(L))
      expect(result.of('item-failed')[0]).toMatchObject({ code: 'trace-execution' })
      expect(result.of('item-ready')).toEqual([])
      expect(await repos.traces.listByCodeBlock(TRACE_CODE_ID)).toEqual([])
    }
  })

  test('simulated fallback retains the normal grounding retry and escalation gate', async () => {
    const repos = await seededTraceRepos()
    const llm = fakeLlm(({ role }) => {
      if (role === 'planner') return plan
      if (role === 'translator') return make.translation({ traceable: false, reason: 'Concurrent threads' })
      if (role === 'extractor.timeline') {
        const timeline = make.timelineIR()
        return { ...timeline, events: timeline.events.map((event) => ({ ...event, evidence: { blockId: `${L}#b0`, quote: 'Invented event never mentioned in this book.' } })) }
      }
      throw new Error(`unexpected ${role}`)
    })
    const result = await collect(pipelineWith(repos, llm, { flags, traceRunner: { runTrace: async () => [] } }).requestSection(L))
    expect(result.of('item-failed')[0]).toMatchObject({ code: 'validation', report: { retried: true, escalated: true } })
    expect(result.of('item-ready')).toEqual([])
    expect(llm.calls.filter((call) => call.role === 'extractor.timeline').map((call) => call.opts.escalate ?? false)).toEqual([false, false, true])
  })
})
