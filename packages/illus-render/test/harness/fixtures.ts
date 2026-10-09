// Visual-regression and behaviour fixtures, built from @illus/core/testing factories.
import { emptyFrame } from '@illus/core'
import type { FrameState, IR } from '@illus/core'
import { make, Q, smallBookBlocks } from '@illus/core/testing'

import type { VisualSpec } from '../../src/index.ts'

export interface Fixture {
  spec: VisualSpec
  frame?: FrameState
  htmlFallback?: boolean
}

const mathBlock = smallBookBlocks().find((b) => b.blockId === make.mathIR().sourceBlockId)!

const graphAll = make.graphIR({
  title: 'Log replication, all shapes',
  nodes: [
    { id: 'client', label: 'Client', shape: 'actor', evidence: Q.request },
    { id: 'leader', label: 'Leader', sublabel: 'current term', shape: 'box', group: 'srv', evidence: Q.request },
    { id: 'log', label: 'Log', shape: 'store', group: 'srv', evidence: Q.append },
    { id: 'outbox', label: 'AppendEntries queue', shape: 'queue', evidence: Q.appendEntries },
    { id: 'majority', label: 'Majority has entry?', shape: 'decision', evidence: Q.committed },
    { id: 'note', label: 'Entries carry a term number', shape: 'note', evidence: Q.entryFields },
  ],
  edges: [
    { id: 'e1', from: 'client', to: 'leader', label: 'request', style: 'solid', evidence: Q.request },
    { id: 'e2', from: 'leader', to: 'log', label: 'append', style: 'solid', evidence: Q.append },
    { id: 'e3', from: 'leader', to: 'outbox', style: 'solid', evidence: Q.appendEntries },
    { id: 'e4', from: 'outbox', to: 'majority', label: 'replies', style: 'dashed', evidence: Q.reply },
    { id: 'e5', from: 'log', to: 'note', style: 'dashed', evidence: Q.entryFields },
  ],
  groups: [{ id: 'srv', label: 'Leader server', evidence: Q.request }],
})

const graphFrame: FrameState = {
  ...emptyFrame(['node:follower']),
  step: 2,
  stepId: 's2',
  highlights: { 'node:leader': 'focus', 'edge:e2': 'success', 'node:log': 'warning', 'node:client': 'muted' },
  pointers: { head: 'node:log' },
  values: { 'node:leader': 3 },
  annotations: { 'node:leader': 'appends the command' },
  tokens: [{ id: 'cmd', label: 'x', path: ['e1', 'e2'] }],
}

const chart = make.chartIR({
  title: 'Cost of a replication round',
  series: [
    { name: 'AppendEntries', fn: 'linear', evidence: Q.appendEntries },
    { name: 'measured', points: [[1, 2], [3, 5], [5, 7], [9, 12]], evidence: Q.appendEntries },
    { name: 'pairs', fn: 'nlogn', evidence: Q.appendEntries },
  ],
})

/** Labels that would run script if any renderer injected them as markup. */
export const XSS = `<img src=x onerror="window.__xss=1">`
const xssIRs: IR[] = [
  make.graphIR({ title: XSS, nodes: make.graphIR().nodes.map((n) => ({ ...n, label: XSS.slice(0, 40) })) }),
  make.sequenceIR({ participants: make.sequenceIR().participants.map((p) => ({ ...p, label: XSS.slice(0, 40) })), messages: make.sequenceIR().messages.map((m) => ({ ...m, label: '<script>window.__xss=1</script>' })) }),
  make.stateIR({ states: make.stateIR().states.map((s) => ({ ...s, label: XSS.slice(0, 40) })) }),
  make.classIR({ classes: make.classIR().classes.map((c) => ({ ...c, label: XSS.slice(0, 40), fields: c.fields.map((f) => ({ ...f, name: '<b onmouseover=x>' })) })) }),
  make.erIR({ entities: make.erIR().entities.map((e) => ({ ...e, label: XSS.slice(0, 40) })), relationships: make.erIR().relationships.map((r) => ({ ...r, label: XSS.slice(0, 40) })) }),
  make.chartIR({ title: XSS, xLabel: XSS.slice(0, 40), series: [{ name: XSS.slice(0, 40), fn: 'linear', evidence: Q.appendEntries }] }),
  make.mathIR({ terms: [{ symbol: '<img src=x onerror=1>', meaning: XSS, evidence: Q.committed }] }),
  make.timelineIR({ lanes: make.timelineIR().lanes.map((l) => ({ ...l, label: XSS.slice(0, 40) })), events: make.timelineIR().events.map((e) => ({ ...e, label: XSS.slice(0, 40) })) }),
]

/** HTML fallback content that probes the sandbox and reports back to the parent. */
export const SANDBOX_PROBE = `<!doctype html><html><body><p id="msg">Sandboxed explainer</p><script>
const r = { ran: true };
try { r.parentDom = !!parent.document.body } catch (e) { r.parentDom = 'blocked' }
try { r.cookie = document.cookie; } catch (e) { r.cookie = 'blocked' }
try { localStorage.setItem('k', 'v'); r.storage = 'open' } catch (e) { r.storage = 'blocked' }
try { r.idb = !!indexedDB.open('x') } catch (e) { r.idb = 'blocked' }
fetch('/illus-sandbox.html').then(() => { r.fetch = 'open' }, () => { r.fetch = 'blocked' }).finally(() => parent.postMessage({ probe: r }, '*'));
</script></body></html>`

export const FIXTURES: Record<string, Fixture> = {
  graph: { spec: { ir: make.graphIR(), groundingScore: 0.92 } },
  'graph-shapes': { spec: { ir: graphAll, groundingScore: 1 } },
  'graph-frame': { spec: { ir: graphAll, groundingScore: 1 }, frame: graphFrame },
  'graph-concept': { spec: { ir: make.graphIR({ title: 'Leader (concept model)' }), groundingScore: 1, newIds: ['follower', 'e3', 'e4'] } },
  sequence: { spec: { ir: make.sequenceIR(), groundingScore: 1 } },
  'sequence-frame': {
    spec: { ir: make.sequenceIR(), groundingScore: 1 },
    frame: { ...emptyFrame(['msg:m3']), step: 2, highlights: { 'msg:m2': 'focus', 'node:follower': 'success' }, annotations: { 'msg:m2': 'in parallel' } },
  },
  state: { spec: { ir: make.stateIR({ final: [] }), groundingScore: 0.83 } },
  class: { spec: { ir: make.classIR(), groundingScore: 1 } },
  er: { spec: { ir: make.erIR(), groundingScore: 1 } },
  chart: { spec: { ir: chart, groundingScore: 1 } },
  'chart-log': { spec: { ir: make.chartIR({ logY: true, series: [{ name: 'exponential', fn: 'exponential', evidence: Q.appendEntries }, { name: 'quadratic', fn: 'quadratic', evidence: Q.appendEntries }] }), groundingScore: 1 } },
  math: { spec: { ir: make.mathIR({ terms: [{ symbol: 'n', meaning: 'number of servers', evidence: Q.committed }] }), mathBlock, groundingScore: 1 } },
  timeline: { spec: { ir: make.timelineIR(), title: 'Replication timeline', groundingScore: 1 } },
  html: { spec: { ir: make.htmlIR({ html: '<!doctype html><body style="font-family:sans-serif"><h3>Log replication</h3><p>Explained without evidence.</p></body>' }) }, htmlFallback: true },
  'html-off': { spec: { ir: make.htmlIR() } },
  'html-probe': { spec: { ir: make.htmlIR({ html: SANDBOX_PROBE }) }, htmlFallback: true },
  template: { spec: { ir: make.templateIR(), groundingScore: 1 } },
  ...Object.fromEntries(xssIRs.map((ir) => [`xss-${ir.type}`, { spec: { ir } }])),
}

/** Fixtures with a visual-regression baseline. */
export const VISUAL_FIXTURES = [
  'graph',
  'graph-shapes',
  'graph-frame',
  'graph-concept',
  'sequence',
  'sequence-frame',
  'state',
  'class',
  'er',
  'chart',
  'chart-log',
  'math',
  'timeline',
  'html',
  'template',
]
