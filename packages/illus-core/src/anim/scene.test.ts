import { describe, expect, it } from 'vitest'
import { emptyFrame } from '../schemas/animation.ts'
import type { GraphIR } from '../schemas/ir.ts'
import { cameraBox, sceneOf } from './scene.ts'
import type { Scene, SceneBox } from './scene.ts'

const evidence = { blockId: 'b', quote: 'A leads to B and C.' }
const ir: GraphIR = {
  type: 'graph',
  title: 'Flow',
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
  groups: [{ id: 'g', label: 'Group', evidence }],
}
const full: SceneBox = { x: 10, y: 20, width: 400, height: 200 }
const boxes: Record<string, SceneBox> = {
  'node:a': { x: 10, y: 20, width: 40, height: 30 },
  'node:b': { x: 190, y: 105, width: 40, height: 30 },
  'node:c': { x: 370, y: 190, width: 40, height: 30 },
  'edge:ab': { x: 50, y: 50, width: 140, height: 55 },
  'group:g': full,
}
const scene = (visible: string[], focus: string | null = null): Scene => ({
  step: 0,
  visible: new Set(visible),
  faded: new Set(),
  tones: {},
  annotations: {},
  tokens: [],
  focus,
})
function freeze(value: object) {
  for (const child of Object.values(value))
    if (child && typeof child === 'object') freeze(child)
  Object.freeze(value)
}

describe('graph scenes', () => {
  it('derives hidden edges and includes nodes, edges and groups in IR order', () => {
    const shown = sceneOf(ir, emptyFrame(['node:b']))
    expect([...shown.visible]).toEqual(['node:a', 'node:c', 'group:g'])
    expect([...shown.faded]).toEqual([])
  })
  it('puts removed nodes and their edges in faded instead of visible', () => {
    const shown = sceneOf(ir, { ...emptyFrame(), removed: ['node:b'] })
    expect([...shown.visible]).toEqual(['node:a', 'node:c', 'group:g'])
    expect([...shown.faded]).toEqual(['node:b', 'edge:ab', 'edge:bc'])
  })
  it('hiding wins over removal for both nodes and their edges', () => {
    const shown = sceneOf(ir, {
      ...emptyFrame(['node:b', 'edge:ab']),
      removed: ['node:b', 'edge:ab'],
    })
    expect([...shown.visible]).toEqual(['node:a', 'node:c', 'group:g'])
    expect([...shown.faded]).toEqual([])
  })
  it('normalizes all-focus and copies frame decorations without mutating frozen inputs', () => {
    const frame = {
      ...emptyFrame(),
      focus: 'all' as const,
      highlights: { 'node:a': 'focus' as const },
      annotations: { 'node:a': 'start' },
      tokens: [{ id: 't', label: 'T', path: ['ab'] }],
    }
    const original = structuredClone(frame)
    freeze(frame)
    const shown = sceneOf(ir, frame)
    expect(shown.focus).toBeNull()
    expect(shown.tones).toEqual(frame.highlights)
    expect(shown.tones).not.toBe(frame.highlights)
    expect(shown.annotations).not.toBe(frame.annotations)
    expect(shown.tokens).toEqual(frame.tokens)
    expect(shown.tokens).not.toBe(frame.tokens)
    expect(shown.tokens[0]!.path).not.toBe(frame.tokens[0]!.path)
    expect(frame).toEqual(original)
  })
  it('drops tokens derived to cross hidden edges and preserves explicit target focus', () => {
    const shown = sceneOf(ir, {
      ...emptyFrame(['node:b']),
      focus: 'node:a',
      tokens: [{ id: 't', path: ['ab'] }],
    })
    expect(shown.tokens).toEqual([])
    expect(shown.focus).toBe('node:a')
  })
})

describe('camera boxes', () => {
  it('centres the minimum 45% extent on a node away from the boundary', () => {
    expect(cameraBox(scene(['node:b']), boxes, full)).toEqual({
      x: 120,
      y: 75,
      width: 180,
      height: 90,
    })
  })
  it('clamps a minimum-size view to the full extent at either boundary', () => {
    expect(cameraBox(scene(['node:a']), boxes, full)).toEqual({
      x: 10,
      y: 20,
      width: 180,
      height: 90,
    })
    expect(cameraBox(scene(['node:c']), boxes, full)).toEqual({
      x: 230,
      y: 130,
      width: 180,
      height: 90,
    })
  })
  it('clamps the padded whole graph back to full', () => {
    expect(cameraBox(scene(Object.keys(boxes)), boxes, full)).toEqual(full)
  })
  it('uses a focused edge box instead of the visible union', () => {
    expect(
      cameraBox(scene(Object.keys(boxes), 'edge:ab'), boxes, full, {
        padding: 0,
        minFraction: 0,
      }),
    ).toEqual(boxes['edge:ab'])
  })
  it('falls back to the node/group union when focus has no box and ignores edge boxes', () => {
    expect(
      cameraBox(scene(['node:b', 'edge:ab'], 'node:missing'), boxes, full),
    ).toEqual(cameraBox(scene(['node:b']), boxes, full))
  })
  it('returns full for an empty scene or missing visible geometry', () => {
    expect(cameraBox(scene([]), boxes, full)).toEqual(full)
    expect(cameraBox(scene(['node:missing']), boxes, full)).toEqual(full)
  })
  it('applies custom padding and rounds every coordinate to one decimal', () => {
    expect(
      cameraBox(
        scene(['node:b']),
        { 'node:b': { x: 100.26, y: 80.34, width: 10.22, height: 12.26 } },
        full,
        { padding: 2, minFraction: 0 },
      ),
    ).toEqual({ x: 98.3, y: 78.3, width: 14.2, height: 16.3 })
  })
})
