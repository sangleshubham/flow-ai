import { describe, expect, it } from 'vitest'

import { ground, LlmError } from '@illus/core'
import type { CriticReport, GraphIR, IR, LlmCall, RoleName, ValidationIssue } from '@illus/core'
import { make, smallBookBlocks } from '@illus/core/testing'

import { reviewVisual } from '../review.ts'
import type { Rendered, ReviewEnv } from '../review.ts'

const PASS: CriticReport = { pass: true, scores: { legibility: 4, intentMatch: 4, clutter: 4 }, issues: [] }
const FAIL: CriticReport = { pass: true, scores: { legibility: 4, intentMatch: 4, clutter: 4 }, issues: [{ elementId: 'e1', kind: 'wrong-direction', note: 'reversed' }] }
const finding = (code: string): ValidationIssue => ({ layer: 'render', severity: 'warning', code, message: code })

/** Answers each role from a queue (or throws an Error in the queue); records the roles called. */
function fakeLlm(answers: Partial<Record<RoleName, unknown[]>>) {
  const roles: RoleName[] = []
  const llm: LlmCall = {
    async call(role) {
      roles.push(role)
      const next = answers[role]?.shift()
      if (next instanceof Error) throw next
      return { data: next as never, model: 'gpt-6.1-sol', effort: 'low', promptVersion: '1.0.0', usage: { input: 10, output: 5, cachedInput: 0 }, latencyMs: 1, requestId: 'r' }
    },
  }
  return { llm, roles }
}

const graph = make.graphIR({ direction: 'LR' })
const record = (ir: IR = graph) => make.visualRecord({ kind: ir.type, ir, usageTokens: 100 })
const repair = { context: { prefix: 'P', body: 'B' }, validation: { blocks: new Map(smallBookBlocks().map((b) => [b.blockId, b])), ground } }
const env = (llm: LlmCall, render: (ir: IR) => Rendered, o: Partial<ReviewEnv> = {}): ReviewEnv => ({
  llm,
  render: async (ir) => render(ir),
  intent: 'Show the request path',
  repair,
  ...o,
})

describe('reviewVisual (§16 L4/L5)', () => {
  it('judges a clean visual once and records the critic run', async () => {
    const { llm, roles } = fakeLlm({ critic: [PASS] })
    const out = await reviewVisual(record(), env(llm, () => ({ issues: [], pngBase64: 'png' })))
    expect(roles).toEqual(['critic'])
    expect(out.critic?.pass).toBe(true)
    expect(out.ir).toEqual(graph)
    expect(out.usageTokens).toBe(115)
    expect(out.models.critic).toBe('gpt-6.1-sol@low')
  })

  it('flips LR to TB when the aspect ratio is off, without calling repair', async () => {
    const { llm, roles } = fakeLlm({ critic: [PASS] })
    const out = await reviewVisual(record(), env(llm, (ir) => ({ issues: (ir as GraphIR).direction === 'LR' ? [finding('aspect-ratio')] : [], pngBase64: 'png' })))
    expect((out.ir as GraphIR).direction).toBe('TB')
    expect(roles).toEqual(['critic'])
    expect(out.validation.issues.map((i) => i.code)).toContain('direction-flipped')
  })

  it('repairs once for findings the re-layout cannot fix and keeps what is left as warnings', async () => {
    const { llm, roles } = fakeLlm({ repair: [graph], critic: [PASS] })
    const out = await reviewVisual(record(), env(llm, () => ({ issues: [finding('label-overlap')], pngBase64: 'png' })))
    expect(roles).toEqual(['repair', 'critic'])
    expect(out.validation.ok).toBe(true)
    expect(out.validation.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['repaired', 'label-overlap']))
  })

  it('repairs once with the critic’s issues and judges again; a second failure is kept with its report', async () => {
    const fixed = make.graphIR({ title: 'Fixed' })
    const { llm, roles } = fakeLlm({ critic: [FAIL, FAIL], repair: [fixed] })
    const out = await reviewVisual(record(), env(llm, () => ({ issues: [], pngBase64: 'png' })))
    expect(roles).toEqual(['critic', 'repair', 'critic'])
    expect(out.critic?.pass).toBe(false)
    expect((out.ir as GraphIR).title).toBe('Fixed')
  })

  it('keeps the original IR when the repaired one fails validation', async () => {
    const { llm } = fakeLlm({ critic: [FAIL, PASS], repair: [{ ...graph, nodes: [] }] })
    const out = await reviewVisual(record(), env(llm, () => ({ issues: [], pngBase64: 'png' })))
    expect(out.ir).toEqual(graph)
    expect(out.validation.issues.map((i) => i.code)).toContain('repair-rejected')
  })

  it('without repair context, only records findings and the critic report', async () => {
    const { llm, roles } = fakeLlm({ critic: [FAIL] })
    const out = await reviewVisual(record(), env(llm, () => ({ issues: [finding('edge-crossings')], pngBase64: 'png' }), { repair: undefined }))
    expect(roles).toEqual(['critic'])
    expect(out.critic?.pass).toBe(false)
  })

  it('skips the critic when turned off, and kinds without an SVG entirely', async () => {
    const { llm, roles } = fakeLlm({})
    await reviewVisual(record(), env(llm, () => ({ issues: [], pngBase64: 'png' }), { critic: false }))
    const math = make.mathIR()
    expect(await reviewVisual(record(math), env(llm, () => { throw new Error('not rendered') }))).toEqual(record(math))
    expect(roles).toEqual([])
  })

  it('stops on plan-limit but survives other model errors', async () => {
    const limited = fakeLlm({ critic: [new LlmError('plan-limit', 'limit')] })
    await expect(reviewVisual(record(), env(limited.llm, () => ({ issues: [], pngBase64: 'png' })))).rejects.toThrow('limit')
    const flaky = fakeLlm({ critic: [new LlmError('upstream', 'boom')] })
    const out = await reviewVisual(record(), env(flaky.llm, () => ({ issues: [], pngBase64: 'png' })))
    expect(out.validation.issues.map((i) => i.code)).toContain('critic-failed')
  })
})
