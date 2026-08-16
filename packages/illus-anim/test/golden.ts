import type { AnimationIR, IR } from '@illus/core'

export const quote =
  'Compare adjacent values and swap them into ascending order.'
export const evidence = { blockId: 'animation-array', quote }
export const arrayIR: IR = {
  type: 'template',
  templateId: 'array',
  props: { values: [3, 1, 2], variant: 'bars' },
  evidence: [{ path: 'values', evidence }],
}
export const arrayAnimation: AnimationIR = {
  planItemId: 'sort',
  initialHidden: [],
  steps: [
    {
      id: 'compare',
      narration: 'Compare adjacent values.',
      evidence,
      actions: [
        { op: 'highlight', target: 'cell:values[0]', tone: 'focus' },
        { op: 'highlight', target: 'cell:values[1]', tone: 'focus' },
        { op: 'pointer', name: 'i', target: 'cell:values[0]' },
      ],
    },
    {
      id: 'swap',
      narration: 'Swap them into ascending order.',
      evidence,
      actions: [
        { op: 'swap', a: 'cell:values[0]', b: 'cell:values[1]' },
        { op: 'annotate', target: 'cell:values[1]', text: 'moved' },
      ],
    },
    {
      id: 'finish',
      narration: 'Swap adjacent values into ascending order.',
      evidence,
      actions: [
        { op: 'swap', a: 'cell:values[1]', b: 'cell:values[2]' },
        { op: 'unhighlight', target: 'all' },
        { op: 'highlight', target: 'cell:values[2]', tone: 'success' },
      ],
    },
  ],
}
export const sequenceQuote =
  'The client sends a request. The server replies to the client.'
const seqEv = { blockId: 'animation-sequence', quote: sequenceQuote }
export const sequenceIR: IR = {
  type: 'sequence',
  title: 'Request and reply',
  participants: [
    { id: 'client', label: 'client', evidence: seqEv },
    { id: 'server', label: 'server', evidence: seqEv },
  ],
  messages: [
    {
      id: 'request',
      from: 'client',
      to: 'server',
      label: 'request',
      kind: 'sync',
      evidence: seqEv,
    },
    {
      id: 'reply',
      from: 'server',
      to: 'client',
      label: 'reply',
      kind: 'reply',
      evidence: seqEv,
    },
  ],
}
export const sequenceAnimation: AnimationIR = {
  planItemId: 'protocol',
  initialHidden: ['msg:request', 'msg:reply'],
  steps: [
    {
      id: 'request',
      narration: 'The client sends a request.',
      evidence: seqEv,
      actions: [
        { op: 'reveal', target: 'msg:request' },
        { op: 'highlight', target: 'msg:request', tone: 'focus' },
      ],
    },
    {
      id: 'reply',
      narration: 'The server replies to the client.',
      evidence: seqEv,
      actions: [
        { op: 'reveal', target: 'msg:reply' },
        { op: 'unhighlight', target: 'all' },
        { op: 'highlight', target: 'msg:reply', tone: 'success' },
      ],
    },
  ],
}
export const graphIR: IR = {
  type: 'graph',
  title: 'Token travel',
  direction: 'LR',
  nodes: [
    { id: 'a', label: 'source', shape: 'box', evidence },
    { id: 'b', label: 'destination', shape: 'box', evidence },
  ],
  edges: [{ id: 'e', from: 'a', to: 'b', style: 'solid', evidence }],
  groups: [],
}
export const graphAnimation: AnimationIR = {
  planItemId: 'token',
  initialHidden: [],
  steps: [
    {
      id: 'travel',
      narration: 'The token travels along the edge.',
      evidence,
      actions: [{ op: 'token', id: 't', label: 'T', path: ['e'] }],
    },
    {
      id: 'done',
      narration: 'The token arrives at its destination.',
      evidence,
      actions: [{ op: 'highlight', target: 'node:b', tone: 'success' }],
    },
  ],
}
