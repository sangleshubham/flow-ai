import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { z } from 'zod'
import { emptyFrame } from '../schemas/animation.ts'
import type { Action, AnimationIR } from '../schemas/animation.ts'
import {
  animationTargets,
  apply,
  buildFrames,
  validateAnimation,
} from './index.ts'

const evidence = { blockId: 'b', quote: 'The client sends a request' }
const ir = {
  type: 'sequence' as const,
  title: 'Request',
  participants: [
    { id: 'c', label: 'client', evidence },
    { id: 's', label: 'server', evidence },
  ],
  messages: [
    {
      id: 'm',
      from: 'c',
      to: 's',
      label: 'request',
      kind: 'sync' as const,
      evidence,
    },
  ],
}
const animation: AnimationIR = {
  planItemId: 'p',
  initialHidden: ['msg:m'],
  steps: [
    {
      id: 'one',
      narration: 'client sends request',
      evidence,
      actions: [{ op: 'reveal', target: 'msg:m' }],
    },
    {
      id: 'two',
      narration: 'server reads request',
      evidence,
      actions: [{ op: 'highlight', target: 'msg:m', tone: 'success' }],
    },
  ],
}

describe('animation frames', () => {
  it('builds a base frame and one immutable frame per step', () => {
    const frames = buildFrames(ir, animation)
    expect(frames).toHaveLength(3)
    expect(frames[0]!.hidden).toEqual(['msg:m'])
    expect(frames[1]!.hidden).toEqual([])
    expect(frames[2]!.highlights).toEqual({ 'msg:m': 'success' })
  })
  it('preserves highlights and pointers but clears annotations and tokens', () => {
    const a = apply(emptyFrame(), [
      { op: 'highlight', target: 'node:a', tone: 'focus' },
      { op: 'pointer', name: 'i', target: 'node:a' },
      { op: 'annotate', target: 'node:a', text: 'here' },
      { op: 'token', id: 't', path: ['e'] },
    ])
    const b = apply(a, [])
    expect(b.highlights).toEqual(a.highlights)
    expect(b.pointers).toEqual(a.pointers)
    expect(b.annotations).toEqual({})
    expect(b.tokens).toEqual([])
    expect(a.tokens).toHaveLength(1)
    expect(
      apply(b, [
        { op: 'pointer', name: 'i', target: null },
        { op: 'unhighlight', target: 'all' },
      ]).pointers,
    ).toEqual({})
  })
  it('exchanges position contents including set overrides on repeated swaps', () => {
    const a = apply(emptyFrame(), [
      { op: 'set', target: 'node:a', value: 9 },
      { op: 'swap', a: 'node:a', b: 'node:b' },
    ])
    expect(a.values).toEqual({ 'node:b': 9 })
    expect(a.slots).toEqual({ 'node:a': 'node:b', 'node:b': 'node:a' })
    expect(apply(a, [{ op: 'swap', a: 'node:a', b: 'node:b' }]).slots).toEqual(
      {},
    )
  })
  it('handles hide reveal focus add remove and container FIFO/LIFO', () => {
    let f = apply(emptyFrame(), [
      { op: 'hide', target: 'node:a' },
      { op: 'focus', target: 'node:a' },
      { op: 'add', parent: 'a', element: { id: 'b', label: 'B' } },
      { op: 'push', container: 'stack', id: 'x', value: 1 },
      { op: 'push', container: 'stack', id: 'y', value: 2 },
    ])
    expect(f.relayout).toBe(true)
    expect(f.added[0]!.parent).toBe('a')
    f = apply(f, [
      { op: 'pop', container: 'stack' },
      { op: 'reveal', target: 'node:a' },
      { op: 'remove', target: 'node:b' },
    ])
    expect(f.containers.stack).toEqual([{ id: 'x', value: 1 }])
    expect(f.removed).toContain('item:y')
    expect(f.hidden).toEqual([])
    f = apply(f, [
      { op: 'enqueue', container: 'queue', id: 'z', value: 3 },
      { op: 'dequeue', container: 'queue' },
    ])
    expect(f.containers.queue).toEqual([])
  })
  it('fails unknown targets and unsupported actions during build', () => {
    expect(() =>
      buildFrames(ir, { ...animation, initialHidden: ['node:missing'] }),
    ).toThrow(/target/)
    expect(() =>
      buildFrames(ir, {
        ...animation,
        steps: animation.steps.map((s) => ({
          ...s,
          actions: [{ op: 'push', container: 'stack', id: 'a', value: 1 }],
        })),
      }),
    ).toThrow(/unsupported/)
    expect(validateAnimation(ir, animation).ok).toBe(false)
  })
  it('property: arbitrary valid highlight/visibility sequences preserve frame schema and replay deterministically', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom<Action>(
            { op: 'highlight', target: 'msg:m', tone: 'focus' },
            { op: 'unhighlight', target: 'all' },
            { op: 'reveal', target: 'msg:m' },
            { op: 'hide', target: 'msg:m' },
          ),
          { minLength: 2, maxLength: 40 },
        ),
        (actions) => {
          const anim = {
            ...animation,
            steps: actions.map((action, i) => ({
              id: String(i),
              narration: 'request',
              evidence,
              actions: [action],
            })),
          }
          const first = buildFrames(ir, anim)
          expect(first).toEqual(buildFrames(ir, anim))
          expect(first.every((f) => f.hidden.every((t) => t === 'msg:m'))).toBe(
            true,
          )
          expect(first[0]!.highlights).toEqual({})
        },
      ),
      { numRuns: 200 },
    )
  })
  it('property: arbitrary array swaps preserve template invariants and the original values', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 3 }),
            fc.integer({ min: 0, max: 3 }),
          ),
          { minLength: 2, maxLength: 40 },
        ),
        (pairs) => {
          const props = { values: [4, 1, 3, 2] }
          let checked = 0
          const template = {
            id: 'array' as const,
            description: 'array',
            whenToUse: 'sort',
            propsSchema: z.object({
              values: z.array(z.number()).length(4),
              pointers: z
                .array(z.object({ name: z.string(), index: z.number() }))
                .optional(),
            }),
            example: props,
            supportedActions: ['swap' as const],
            targets: () => props.values.map((_, i) => `cell:values[${i}]`),
            checkInvariants: (p: unknown) => {
              checked++
              return [...(p as typeof props).values].sort().join(',') ===
                '1,2,3,4'
                ? []
                : ['values changed']
            },
          }
          const templates = {
            getTemplate: () => template,
            listTemplates: () => [template],
          }
          const anim = {
            ...animation,
            initialHidden: [],
            steps: pairs.map(([a, b], i) => ({
              id: String(i),
              narration: 'swap values',
              evidence,
              actions: [
                {
                  op: 'swap' as const,
                  a: `cell:values[${a}]` as const,
                  b: `cell:values[${b}]` as const,
                },
              ],
            })),
          }
          const ir = {
            type: 'template' as const,
            templateId: 'array' as const,
            props,
            evidence: [],
          }
          const frames = buildFrames(ir, anim, { templates })
          expect(checked).toBe(frames.length)
          expect(frames).toEqual(buildFrames(ir, anim, { templates }))
          expect(props.values).toEqual([4, 1, 3, 2])
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('animationTargets', () => {
  it('lists graph targets sorted with token support', () => {
    const g = {
      type: 'graph' as const,
      nodes: [
        { id: 'b', label: 'B', evidence },
        { id: 'a', label: 'A', evidence },
      ],
      edges: [{ id: 'e', from: 'a', to: 'b', evidence }],
      groups: [],
    } as never
    const r = animationTargets(g)
    expect(r.targets).toEqual(['edge:e', 'node:a', 'node:b'])
    expect(r.supportedActions).toContain('token')
  })
  it('lists sequence targets without token', () => {
    const r = animationTargets(ir)
    expect(r.targets).toEqual(['msg:m', 'node:c', 'node:s'])
    expect(r.supportedActions).not.toContain('token')
  })
  it('uses the template registry, sorted and deduplicated', () => {
    const templates = {
      getTemplate: () => ({
        id: 'stub',
        propsSchema: z.any(),
        targets: () => ['node:z', 'node:a', 'node:z'],
        supportedActions: ['highlight', 'set'],
      }),
    } as never
    const r = animationTargets(
      { type: 'template', templateId: 'stub', props: {} } as never,
      { templates },
    )
    expect(r).toEqual({
      targets: ['node:a', 'node:z'],
      supportedActions: ['highlight', 'set'],
    })
  })
})
