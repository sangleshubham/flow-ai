import { describe, expect, it } from 'vitest'

import { AnimationIR } from '../schemas/animation.ts'
import type { Action, Target } from '../schemas/animation.ts'
import { GraphIR } from '../schemas/ir.ts'
import type { GroundingContext } from '../schemas/ports.ts'
import { make } from '../testing/index.ts'
import { buildFrames, validateAnimation } from './index.ts'
import { defaultStoryboard } from './storyboard.ts'
import { withDerivedVisibility } from './visibility.ts'

function graph(ids: string[], links: [string, string][] = []): GraphIR {
  return GraphIR.parse({
    type: 'graph',
    title: 'Synthetic flow',
    direction: 'LR',
    nodes: ids.map((id) => ({
      id,
      label: `Stage ${id}`,
      shape: 'box',
      evidence: {
        blockId: `block-${id}`,
        quote: `Stage ${id} processes the request.`,
      },
    })),
    edges: links.map(([from, to], i) => ({
      id: `e${i}`,
      from,
      to,
      style: 'solid',
      evidence: {
        blockId: `block-${from}`,
        quote: `Stage ${from} processes the request.`,
      },
    })),
    groups: [],
  })
}

function grounding(ir: GraphIR): GroundingContext {
  return {
    blocks: new Map(
      ir.nodes.map((n) => [
        n.evidence.blockId,
        make.block({
          blockId: n.evidence.blockId,
          text: n.evidence.quote,
        }),
      ]),
    ),
  }
}

function revealed(actions: readonly Action[]): Target[] {
  return actions.flatMap((a) => (a.op === 'reveal' ? [a.target] : []))
}

function freeze(value: object) {
  for (const child of Object.values(value))
    if (child && typeof child === 'object') freeze(child)
  Object.freeze(value)
}

describe('default graph storyboard', () => {
  it('follows topology rather than node order, with only node targets hidden or revealed', () => {
    const ir = graph(
      ['c', 'a', 'b'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    )
    const animation = defaultStoryboard(ir, 'flow')!
    expect(AnimationIR.parse(animation)).toEqual(animation)
    expect(animation.planItemId).toBe('flow')
    expect(animation.initialHidden).toEqual(['node:c', 'node:b'])
    expect(animation.steps.map((s) => s.narration)).toEqual([
      'Stage a',
      'Stage b',
      'Stage c',
    ])
    expect(animation.steps[0]!.actions).toEqual([
      { op: 'highlight', target: 'node:a', tone: 'focus' },
    ])
    expect(animation.steps[1]!.actions).toEqual([
      { op: 'unhighlight', target: 'all' },
      { op: 'reveal', target: 'node:b' },
      { op: 'highlight', target: 'node:b', tone: 'focus' },
    ])
    expect(animation.steps.map((s) => s.evidence)).toEqual([
      ir.nodes[1]!.evidence,
      ir.nodes[2]!.evidence,
      ir.nodes[0]!.evidence,
    ])
    const frames = buildFrames(ir, animation)
    expect(frames.at(-1)!.hidden).toEqual([])
    expect(frames.at(-1)!.highlights).toEqual({})
    expect(animation.steps.at(-1)!.actions.at(-1)).toEqual({
      op: 'unhighlight',
      target: 'all',
    })
    expect(withDerivedVisibility(ir, frames[0]!).hidden).toContain('edge:e0')
    expect(withDerivedVisibility(ir, frames[2]!).hidden).not.toContain(
      'edge:e0',
    )
    expect(withDerivedVisibility(ir, frames[2]!).hidden).toContain('edge:e1')
  })

  it('breaks Kahn ties by IR node order even when a newly ready node precedes the queue', () => {
    const ir = graph(
      ['d', 'a', 'c', 'b'],
      [
        ['a', 'd'],
        ['a', 'c'],
        ['b', 'c'],
      ],
    )
    expect(
      defaultStoryboard(ir, 'branch')!.steps.map((s) => s.narration),
    ).toEqual(['Stage a', 'Stage d', 'Stage b', 'Stage c'])
  })

  it('breaks cycles at the earliest remaining IR node and resumes the flow', () => {
    const ir = graph(
      ['c', 'a', 'b', 'd'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
        ['c', 'd'],
      ],
    )
    expect(
      defaultStoryboard(ir, 'cycle')!.steps.map((s) => s.narration),
    ).toEqual(['Stage c', 'Stage a', 'Stage b', 'Stage d'])
  })

  it('handles a self-loop without repeating or skipping its node', () => {
    const ir = graph(
      ['a', 'b', 'c'],
      [
        ['a', 'a'],
        ['a', 'b'],
        ['b', 'c'],
      ],
    )
    expect(
      defaultStoryboard(ir, 'loop')!.steps.map((s) => s.narration),
    ).toEqual(['Stage a', 'Stage b', 'Stage c'])
  })

  it('uses two-node chunks for twelve nodes and leaves a complete, unhighlighted final frame', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `n${i}`)
    const ir = graph(
      ids,
      ids.slice(1).map((id, i) => [ids[i]!, id]),
    )
    const animation = defaultStoryboard(ir, 'large')!
    expect(animation.steps).toHaveLength(6)
    expect(animation.initialHidden).toEqual(
      ids.slice(2).map((id) => `node:${id}`),
    )
    expect(animation.steps[0]!.narration).toBe('Stage n0; Stage n1')
    expect(animation.steps[0]!.actions).toHaveLength(2)
    for (const step of animation.steps.slice(1)) {
      expect(revealed(step.actions)).toHaveLength(2)
      expect(step.actions.length).toBeLessThanOrEqual(6)
    }
    expect(animation.steps[1]!.actions).toHaveLength(5)
    expect(animation.steps.at(-1)!.actions).toHaveLength(6)
    const final = buildFrames(ir, animation).at(-1)!
    expect(final.hidden).toEqual([])
    expect(final.highlights).toEqual({})
  })

  it.each([0, 1, 2])('returns null for %i nodes', (count) => {
    expect(
      defaultStoryboard(graph(['a', 'b'].slice(0, count)), 'small'),
    ).toBeNull()
  })

  it('joins labels and sublabels and drops whole items when the pair exceeds 140 characters', () => {
    const ir = graph(Array.from({ length: 9 }, (_, i) => `n${i}`))
    ir.nodes = ir.nodes.map((n) => ({
      ...n,
      label: 'a'.repeat(40),
      sublabel: 'b'.repeat(40),
    }))
    GraphIR.parse(ir)
    const animation = defaultStoryboard(ir, 'long')!
    for (const step of animation.steps) {
      expect(step.narration).toBe(`${'a'.repeat(40)}: ${'b'.repeat(40)}`)
      expect(step.narration.length).toBe(82)
    }
    expect(AnimationIR.safeParse(animation).success).toBe(true)
  })

  it('keeps the longest valid single node item nonempty and intact', () => {
    const ir = graph(['a', 'b', 'c'])
    ir.nodes[0] = {
      ...ir.nodes[0]!,
      label: 'long descriptive label for request input',
      sublabel: 'with a grounded descriptive explanation',
    }
    GraphIR.parse(ir)
    expect(defaultStoryboard(ir, 'single')!.steps[0]!.narration).toBe(
      `${ir.nodes[0]!.label}: ${ir.nodes[0]!.sublabel}`,
    )
  })

  it.each([3, 8, 9, 11, 12])(
    'passes real grounding and schema validation for %i nodes',
    (count) => {
      const ids = Array.from({ length: count }, (_, i) => `n${i}`)
      const ir = graph(
        ids,
        ids.slice(1).map((id, i) => [ids[i]!, id]),
      )
      ir.nodes[0]!.sublabel = 'processes the request'
      const animation = defaultStoryboard(ir, 'grounded')!
      const checked = validateAnimation(ir, animation, {
        grounding: grounding(ir),
      })
      expect(checked.issues).toEqual([])
      expect(checked.ok).toBe(true)
      expect(animation.steps.length).toBeLessThanOrEqual(8)
      expect(new Set(animation.steps.map((s) => s.id)).size).toBe(
        animation.steps.length,
      )
      expect(
        animation.steps.every(
          (s) => s.narration.length > 0 && s.narration.length <= 140,
        ),
      ).toBe(true)
    },
  )

  it('is deterministic and never mutates a frozen graph or its evidence', () => {
    const ir = graph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    )
    const original = structuredClone(ir)
    freeze(ir)
    expect(defaultStoryboard(ir, 'pure')).toEqual(defaultStoryboard(ir, 'pure'))
    expect(ir).toEqual(original)
  })
})
