import { describe, expect, it } from 'vitest'

import { ground } from '@illus/core'
import type { CriticReport, GraphIR, LlmCall, RoleName } from '@illus/core'
import { make, smallBookBlocks } from '@illus/core/testing'

import { reviewHook } from '../render.tsx'

const FAIL: CriticReport = { pass: false, scores: { legibility: 4, intentMatch: 2, clutter: 4 }, issues: [{ elementId: 'e1', kind: 'wrong-direction', note: 'reversed' }] }
const PASS: CriticReport = { pass: true, scores: { legibility: 4, intentMatch: 4, clutter: 4 }, issues: [] }

describe('reviewHook (PipelineDeps.review)', () => {
  it('runs the full loop with the pipeline context: intent from the plan item, repair with its packed context', async () => {
    const fixed = make.graphIR({ title: 'Fixed' })
    const answers: Partial<Record<RoleName, unknown[]>> = { critic: [FAIL, PASS], repair: [fixed] }
    const calls: { role: RoleName; body: string; signal?: AbortSignal }[] = []
    const llm: LlmCall = {
      async call(role, ctx, opts) {
        calls.push({ role, body: ctx.body, ...(opts?.signal && { signal: opts.signal }) })
        return { data: answers[role]!.shift() as never, model: 'm', effort: 'low', promptVersion: '1.0.0', usage: { input: 1, output: 1, cachedInput: 0 }, latencyMs: 1, requestId: 'r' }
      },
    }
    const signal = new AbortController().signal
    const hook = reviewHook({ llm, theme: {} as never, render: async () => ({ issues: [], pngBase64: 'png' }) })
    const out = await hook(make.visualRecord({ kind: 'graph', ir: make.graphIR({ direction: 'LR' }) }), {
      context: { prefix: 'P', body: 'PACKED-CONTEXT' },
      validation: { blocks: new Map(smallBookBlocks().map((b) => [b.blockId, b])), ground },
      planItem: { planItemId: 'p1', kind: 'graph', intent: 'Show the request path', conceptIds: [], priority: 1, animate: false },
      signal,
    })
    expect(calls.map((c) => c.role)).toEqual(['critic', 'repair', 'critic'])
    expect(calls[0]!.body).toContain('Show the request path')
    expect(calls[1]!.body).toContain('PACKED-CONTEXT')
    expect(calls.every((c) => c.signal === signal)).toBe(true)
    expect((out.ir as GraphIR).title).toBe('Fixed')
    expect(out.critic?.pass).toBe(true)
  })
})
