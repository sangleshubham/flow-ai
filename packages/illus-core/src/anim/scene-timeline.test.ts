import { describe, expect, it } from 'vitest'
import { emptyFrame } from '../schemas/animation.ts'
import type { FrameState } from '../schemas/animation.ts'
import type { GraphIR } from '../schemas/ir.ts'
import { compileSceneTimeline } from './scene-timeline.ts'
import type { SceneBox } from './scene.ts'

const evidence = { blockId: 'b', quote: 'A leads to B and C.' }
const ir: GraphIR = {
  type: 'graph',
  title: 'Chain',
  direction: 'LR',
  nodes: ['a', 'b', 'c'].map((id) => ({
    id,
    label: id,
    shape: 'box',
    evidence,
  })),
  edges: [
    { id: 'ab', from: 'a', to: 'b', style: 'solid', evidence },
    { id: 'bc', from: 'b', to: 'c', style: 'solid', evidence },
  ],
  groups: [],
}
const boxes: Record<string, SceneBox> = {
  'node:a': { x: 20, y: 50, width: 80, height: 40 },
  'node:b': { x: 250, y: 50, width: 80, height: 40 },
  'node:c': { x: 500, y: 50, width: 80, height: 40 },
}
const full = { x: 0, y: 0, width: 600, height: 200 }
const frames = [
  emptyFrame(['node:b', 'node:c']),
  { ...emptyFrame(['node:c']), step: 1 },
  { ...emptyFrame(), step: 2 },
]
const compile = (fs: readonly FrameState[] = frames, graph = ir) =>
  compileSceneTimeline(graph, fs, boxes, full)
function freeze(value: object) {
  for (const child of Object.values(value))
    if (child && typeof child === 'object') freeze(child)
  Object.freeze(value)
}

describe('declarative scene timeline', () => {
  it('reveals a node, then draws its edge after its show ends, and moves the camera', () => {
    const plan = compile()
    expect(plan.initial.visible).toEqual(new Set(['node:a']))
    expect(plan.steps).toHaveLength(2)
    const step = plan.steps[0]!
    expect(step).toMatchObject({ index: 1, start: 0 })
    expect(step.tweens).toContainEqual({
      kind: 'show',
      target: 'node:b',
      at: 0.2,
      duration: 0.35,
    })
    expect(step.tweens).toContainEqual({
      kind: 'draw',
      target: 'edge:ab',
      at: 0.55,
      duration: 0.35,
    })
    expect(step.tweens).toContainEqual({
      kind: 'camera',
      from: plan.initialCamera,
      to: expect.any(Object),
      at: 0,
      duration: 0.5,
    })
    expect(
      step.tweens.some((t) => 'target' in t && t.target === 'edge:bc'),
    ).toBe(false)
    // Head/label fade starts at .8 * .35 and lasts .15: later than the .35 stroke draw.
    expect(step.end).toBeCloseTo(0.98)
    expect(plan.steps[1]!.start).toBe(step.end)
    expect(plan.duration).toBe(plan.steps[1]!.end)
  })
  it('shows dashed edges without drawing over their dash pattern', () => {
    const plan = compile(frames, {
      ...ir,
      edges: ir.edges.map((edge) => ({ ...edge, style: 'dashed' })),
    })
    expect(plan.steps[0]!.tweens).toContainEqual({
      kind: 'show',
      target: 'edge:ab',
      at: 0.55,
      duration: 0.3,
    })
    expect(plan.steps[0]!.tweens.some((t) => t.kind === 'draw')).toBe(false)
    expect(plan.steps[0]!.end).toBeCloseTo(0.85)
  })
  it('staggers entering nodes then groups in IR order and waits for both endpoints', () => {
    const graph: GraphIR = {
      ...ir,
      nodes: ir.nodes.map((node) => ({ ...node, group: 'g' })),
      groups: [{ id: 'g', label: 'G', evidence }],
    }
    const plan = compile(
      [emptyFrame(['node:a', 'node:b', 'node:c']), emptyFrame()],
      graph,
    )
    const step = plan.steps[0]!
    expect(
      step.tweens.filter((t) => t.kind === 'show').map((t) => [t.target, t.at]),
    ).toEqual([
      ['node:a', 0.2],
      ['node:b', 0.28],
      ['node:c', 0.36],
      ['group:g', 0.44],
    ])
    const draws = step.tweens.filter((t) => t.kind === 'draw')
    expect(draws[0]!.at).toBeCloseTo(0.63)
    expect(draws[1]!.at).toBeCloseTo(0.71)
  })
  it('sets entering tones at appearance completion and changes existing tones at +.2', () => {
    const fs = [
      frames[0]!,
      {
        ...frames[1]!,
        highlights: {
          'node:a': 'success' as const,
          'node:b': 'focus' as const,
          'edge:ab': 'warning' as const,
        },
      },
    ]
    const step = compile(fs).steps[0]!
    expect(step.tweens).toContainEqual({
      kind: 'tone',
      target: 'node:a',
      tone: 'success',
      at: 0.2,
    })
    expect(step.tweens).toContainEqual({
      kind: 'tone',
      target: 'node:b',
      tone: 'focus',
      at: 0.55,
    })
    expect(
      step.tweens.find((t) => t.kind === 'tone' && t.target === 'edge:ab')!.at,
    ).toBeCloseTo(0.98)
  })
  it('clears old tones at the start and updates/clears annotations at +.2', () => {
    const a = {
      ...emptyFrame(),
      highlights: { 'node:a': 'focus' as const },
      annotations: { 'node:a': 'old', 'node:b': 'change' },
    }
    const b = { ...emptyFrame(), annotations: { 'node:b': 'new' } }
    const step = compile([a, b]).steps[0]!
    expect(step.tweens).toContainEqual({
      kind: 'tone',
      target: 'node:a',
      tone: null,
      at: 0,
    })
    expect(step.tweens).toContainEqual({
      kind: 'annotate',
      target: 'node:a',
      text: null,
      at: 0.2,
    })
    expect(step.tweens).toContainEqual({
      kind: 'annotate',
      target: 'node:b',
      text: 'new',
      at: 0.2,
    })
  })
  it('starts parallel tokens after every draw ornament finishes, dropping invisible paths', () => {
    const next = {
      ...frames[1]!,
      tokens: [
        { id: 'one', label: 'One', path: ['ab'] },
        { id: 'two', path: ['ab'] },
        { id: 'hidden', path: ['ab', 'bc'] },
        { id: 'unknown', path: ['missing'] },
      ],
    }
    const step = compile([frames[0]!, next]).steps[0]!
    const tokens = step.tweens.filter((t) => t.kind === 'token')
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toMatchObject({
      kind: 'token',
      id: 'one',
      label: 'One',
      edges: ['ab'],
      duration: 0.8,
    })
    expect(tokens[0]!.at).toBeCloseTo(0.98)
    expect(tokens[1]!.at).toBe(tokens[0]!.at)
    expect(step.end).toBeCloseTo(1.78)
    const removed = {
      ...emptyFrame(),
      removed: ['node:b' as const],
      tokens: [{ id: 'faded', path: ['ab'] }],
    }
    expect(
      compile([emptyFrame(), removed]).steps[0]!.tweens.some(
        (t) => t.kind === 'token',
      ),
    ).toBe(false)
  })
  it('fully handles visible, faded and hidden transitions', () => {
    const visible = emptyFrame()
    const faded = { ...emptyFrame(), removed: ['node:b' as const] }
    const hidden = { ...emptyFrame(['node:b']), removed: ['node:b' as const] }
    const plan = compile([visible, faded, hidden, faded, visible])
    expect(plan.steps[0]!.tweens).toContainEqual({
      kind: 'fade',
      target: 'node:b',
      at: 0,
      duration: 0.3,
    })
    expect(plan.steps[1]!.tweens).toContainEqual({
      kind: 'hide',
      target: 'node:b',
      at: plan.steps[1]!.start,
      duration: 0.3,
    })
    expect(plan.steps[2]!.tweens).toContainEqual({
      kind: 'fade',
      target: 'node:b',
      at: plan.steps[2]!.start,
      duration: 0.3,
    })
    expect(plan.steps[3]!.tweens).toContainEqual({
      kind: 'show',
      target: 'node:b',
      at: plan.steps[3]!.start + 0.2,
      duration: 0.35,
    })
    for (let i = 1; i < plan.steps.length; i++)
      expect(plan.steps[i]!.start).toBe(plan.steps[i - 1]!.end)
  })
  it('uses a minimum .4s step and emits no unchanged decorations or camera moves', () => {
    const frame = {
      ...emptyFrame(),
      highlights: { 'node:a': 'focus' as const },
      annotations: { 'node:a': 'same' },
    }
    const plan = compile([frame, frame])
    expect(plan.steps[0]).toEqual({ index: 1, start: 0, end: 0.4, tweens: [] })
  })
  it('compares camera edges with a strict greater-than-one-unit threshold', () => {
    const focused = { ...emptyFrame(), focus: 'node:b' as const }
    const near = { ...boxes, 'node:a': { ...boxes['node:b']!, x: 251 } }
    const fs = [focused, { ...focused, focus: 'node:a' as const }]
    expect(compileSceneTimeline(ir, fs, near, full).steps[0]!.tweens).toEqual(
      [],
    )
    const farther = { ...near, 'node:a': { ...near['node:a']!, x: 251.2 } }
    expect(
      compileSceneTimeline(ir, fs, farther, full).steps[0]!.tweens[0]!.kind,
    ).toBe('camera')
  })
  it('is deterministic and never mutates its frames or geometry', () => {
    const original = structuredClone({ ir, frames, boxes, full })
    freeze(ir)
    freeze(frames)
    freeze(boxes)
    freeze(full)
    expect(compile()).toEqual(compile())
    expect({ ir, frames, boxes, full }).toEqual(original)
  })
  it('accepts a static initial scene and rejects a missing initial frame', () => {
    expect(compile([emptyFrame()])).toMatchObject({ steps: [], duration: 0 })
    expect(() => compile([])).toThrow(/initial frame/i)
  })
})
