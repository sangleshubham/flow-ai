// Visual fixtures: every template's worked example, plus frames for the animated operations.
import { emptyFrame } from '@illus/core'
import type { FrameState, TemplateIR } from '@illus/core'

import { exampleIR, getTemplate, listTemplates } from '../index.ts'

export interface TemplateFixture {
  ir: TemplateIR
  frame?: FrameState
}

const ex = (id: Parameters<typeof getTemplate>[0]) => exampleIR(getTemplate(id)!)
const frame = (o: Partial<FrameState>): FrameState => ({ ...emptyFrame(), step: 1, ...o })

export const TEMPLATE_FIXTURES: Record<string, TemplateFixture> = {
  ...Object.fromEntries(listTemplates().map((t) => [t.id, { ir: exampleIR(t) }])),
  // A sorting step: two cells swapped, one highlighted, a pointer moved and an annotation.
  'array-frame': {
    ir: { ...ex('array'), props: { values: [5, 2, 9, 1, 7], variant: 'bars', pointers: [{ name: 'i', index: 0 }] } },
    frame: frame({
      slots: { 'cell:values[0]': 'cell:values[3]', 'cell:values[3]': 'cell:values[0]' },
      highlights: { 'cell:values[0]': 'focus', 'cell:values[3]': 'success' },
      pointers: { i: 'cell:values[3]', j: 'cell:values[0]' },
      annotations: { 'cell:values[3]': 'swap 5 and 1' },
    }),
  },
  // Sift-up in a heap: two node keys swapped along an edge, with a token on it.
  'tree-frame': {
    ir: ex('tree'),
    frame: frame({
      slots: { 'node:h1': 'node:h4', 'node:h4': 'node:h1' },
      highlights: { 'node:h1': 'focus', 'node:h4': 'focus', 'edge:h4': 'success' },
      tokens: [{ id: 'k', label: '3', path: ['h1', 'h4'] }],
    }),
  },
  'stack-frame': {
    ir: ex('stack'),
    frame: frame({ containers: { stack: [{ id: 'b1', value: '(' }, { id: 'b2', value: '[' }, { id: 'b3', value: '{' }, { id: 'b4', value: '(' }] }, highlights: { 'item:b4': 'focus' } }),
  },
  'cache-frame': {
    ir: ex('cache'),
    frame: frame({
      added: [{ id: 'kC', label: 'C' }],
      containers: { order: [{ id: 'kB', value: 'B' }, { id: 'kD', value: 'D' }, { id: 'kA', value: 'A' }, { id: 'kC', value: 'C' }] },
      highlights: { 'node:kC': 'success' },
      values: { 'item:kC': 3 },
    }),
  },
  'set-ops-frame': { ir: ex('set-ops'), frame: frame({ highlights: { 'group:users+orders': 'focus' } }) },
  'linked-list-frame': {
    ir: ex('linked-list'),
    frame: frame({ added: [{ id: 'n9', label: '8', parent: 'n2' }], highlights: { 'node:n9': 'success' }, pointers: { slow: 'node:n3', fast: 'node:n5' } }),
  },
}

/** Fixtures with a baseline in light and dark. */
export const TEMPLATE_VISUALS = Object.keys(TEMPLATE_FIXTURES)
