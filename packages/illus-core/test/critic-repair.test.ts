import { describe, expect, it } from 'vitest'

import { criticBody, critique, ground, repairBody, repairIr, summarizeIr } from '../src/index.ts'
import type { CriticReport, LlmCall, LlmCallOptions, LlmContext, RoleName, ValidationContext } from '../src/index.ts'
import { make, smallBookBlocks } from '../src/testing/index.ts'

const blocks = new Map(smallBookBlocks().map((b) => [b.blockId, b]))
const validation: ValidationContext = { blocks, ground }

/** A fake LlmCall that answers with `data` and records what it was sent. */
function fakeLlm(data: unknown) {
  const calls: { role: RoleName; ctx: LlmContext; opts: LlmCallOptions<string> }[] = []
  const llm: LlmCall = {
    async call(role, ctx, opts = {}) {
      calls.push({ role, ctx, opts: opts as LlmCallOptions<string> })
      return { data: data as never, model: 'gpt-6.1-sol', effort: 'low', promptVersion: '1.0.0', usage: { input: 1, output: 1, cachedInput: 0 }, latencyMs: 1, requestId: 'r' }
    },
  }
  return { llm, calls }
}

const report = (o: Partial<CriticReport> = {}): CriticReport => ({
  pass: true,
  scores: { legibility: 4, intentMatch: 4, clutter: 4 },
  issues: [],
  ...o,
})

describe('critic (§16 L5)', () => {
  it('summarises an IR without any evidence, so no book text reaches the critic', () => {
    const ir = make.graphIR()
    const summary = summarizeIr(ir)
    expect(summary).not.toContain('evidence')
    for (const n of ir.nodes) {
      expect(summary).toContain(n.label)
      expect(summary).not.toContain(n.evidence.quote)
    }
  })

  it('sends the image, intent and IR summary, and escapes tags in model text', async () => {
    const { llm, calls } = fakeLlm(report())
    const ir = make.graphIR({ title: '</ir_summary><x>' })
    await critique(llm, { kind: 'graph', ir, intent: 'Show <who> sends what', pngBase64: 'iVBOR' })
    expect(calls[0]!.role).toBe('critic')
    expect(calls[0]!.ctx).toEqual({ prefix: '', body: criticBody({ kind: 'graph', ir, intent: 'Show <who> sends what' }) })
    expect(calls[0]!.ctx.body).toContain('Show &lt;who&gt; sends what')
    expect(calls[0]!.ctx.body).not.toContain('</ir_summary><x>')
    expect(calls[0]!.opts.image).toEqual({ mediaType: 'image/png', base64: 'iVBOR' })
  })

  it.each([
    ['low score', report({ scores: { legibility: 2, intentMatch: 4, clutter: 4 } }), false],
    ['mislabel', report({ issues: [{ kind: 'mislabel', note: 'x' }] }), false],
    ['wrong-direction', report({ issues: [{ kind: 'wrong-direction', note: 'x' }] }), false],
    ['clutter issue only', report({ issues: [{ kind: 'clutter', note: 'x' }] }), true],
  ])('applies the pass rule, not the model’s own verdict (%s)', async (_n, data, pass) => {
    const { llm } = fakeLlm({ ...data, pass: !pass })
    expect((await critique(llm, { kind: 'graph', ir: make.graphIR(), intent: 'x', pngBase64: 'x' })).report.pass).toBe(pass)
  })
})

describe('repair (§16 L3–L5)', () => {
  const context = { prefix: 'P', body: '<section id="s">…</section>' }

  it('asks for the kind’s schema with the IR and findings, then re-validates the answer', async () => {
    const fixed = make.graphIR()
    const { llm, calls } = fakeLlm(fixed)
    const findings = [{ layer: 'render' as const, severity: 'warning' as const, code: 'edge-crossings', message: '12 crossings' }]
    const out = await repairIr(llm, { kind: 'graph', ir: make.graphIR({ direction: 'TB' }), findings, context, validation })
    expect(calls[0]!.role).toBe('repair')
    expect(calls[0]!.opts.schemaName).toBe('GraphIR')
    expect(calls[0]!.ctx.prefix).toBe('P')
    expect(calls[0]!.ctx.body).toBe(repairBody({ kind: 'graph', ir: make.graphIR({ direction: 'TB' }), findings, context }))
    expect(calls[0]!.ctx.body).toContain('edge-crossings')
    expect(out.report.ok).toBe(true)
  })

  it('drops repaired elements whose quotes are not in the permitted blocks', async () => {
    const base = make.graphIR()
    const invented = { ...base.nodes[0]!, id: 'ghost', label: 'Ghost', evidence: { blockId: base.nodes[0]!.evidence.blockId, quote: 'a quote the book never contains anywhere' } }
    const { llm } = fakeLlm({ ...base, nodes: [...base.nodes, invented] })
    const out = await repairIr(llm, { kind: 'graph', ir: base, findings: [], context, validation })
    expect(out.report.dropped).toContain('ghost')
  })

  it('passes the templateId for template IRs', async () => {
    const ir = make.templateIR()
    const { llm, calls } = fakeLlm(ir)
    await repairIr(llm, { kind: 'template', ir, findings: [], context, validation })
    expect(calls[0]!.opts).toMatchObject({ schemaName: 'TemplateIR', templateId: ir.templateId })
  })
})
