// Hand-written model answers for synthetic.epub (CC0), one per W3 role call of the replay integration test.
// `pnpm --filter @illus/pipeline fixtures:llm` replays the whole flow and writes each answer as a
// `"source": "handwritten"` fixture under fixtures/llm/<role>/<key>.json, keyed by the exact prompt the
// pipeline builds. Block ids are written as '@b<n>' (block n of the section the call is about).
import type { SectionIndexOutput, SectionNode } from '@illus/core'

const F = { algorithm: false, protocol: false, architecture: false, dataStructure: false, stateMachine: false, math: false, codeHeavy: false, narrative: false }
const ev = (b: number, quote: string) => ({ blockId: `@b${b}`, quote })

/** Which synthetic section a call is about; titles may change with W1's split rules, so match loosely. */
export type SectionKey = 'preface' | 'ch1' | '1.1' | '1.2' | 'ch2' | '2.1' | '2.2' | '2.3.1' | 'long1' | 'long2' | 'long' | 'ch4'

export function sectionKey(section: SectionNode, all: readonly SectionNode[]): SectionKey | undefined {
  const t = section.title.trim()
  const firstLong = all.filter((s) => s.title.trim().startsWith('3.1 ')).sort((a, b) => a.ordinal - b.ordinal)
  if (t === 'Preface') return 'preface'
  if (t.startsWith('Chapter 1')) return 'ch1'
  if (t.startsWith('Chapter 2')) return 'ch2'
  if (t.startsWith('Chapter 4')) return 'ch4'
  if (t.startsWith('1.1 ')) return '1.1'
  if (t.startsWith('1.2 ')) return '1.2'
  if (t.startsWith('2.1 ')) return '2.1'
  if (t.startsWith('2.2 ')) return '2.2'
  if (t.startsWith('2.3.1 ')) return '2.3.1'
  if (section.sectionId === firstLong[0]?.sectionId) return 'long1'
  if (section.sectionId === firstLong[1]?.sectionId) return 'long2'
  // Other chapter-3 parts: titled '3.2 …' or by their h5 sub-heading ('Part two'), so match by parent.
  const parent = all.find((s) => s.sectionId === section.parentId)
  if (t.startsWith('3.') || parent?.title.trim().startsWith('Chapter 3')) return 'long'
  return undefined
}

const LONG_SUMMARY =
  'A replicated log keeps servers in agreement about command order. The leader sends heartbeats; a follower that misses them starts an election for a new term. Terms order leaders, followers reject mismatched entries, and snapshots compact the log.'
const LONG_USES = ['replicated log', 'leader', 'follower', 'heartbeat', 'election', 'term', 'snapshot', 'state machine', 'log'].map((name) => ({ name }))

/** One indexer entry per section (without `sectionId`, filled in by the generator). */
export const INDEX: Record<SectionKey, Omit<SectionIndexOutput, 'sectionId'>> = {
  preface: {
    summary: 'The book exists to test an EPUB indexer; its text is original and released under CC0.',
    defines: [],
    uses: [{ name: 'EPUB indexer' }],
    flags: { ...F, narrative: true },
  },
  ch1: { summary: 'The chapter introduces the basic building blocks.', defines: [], uses: [], flags: { ...F, narrative: true } },
  '1.1': {
    summary: 'A server can be a follower, candidate or leader. Table 1.1 lists the RequestVote and AppendEntries messages with their senders and purposes; a term is a monotonically increasing election number.',
    defines: [{ name: 'term', evidence: ev(3, 'Term A monotonically increasing election number.') }],
    uses: ['server', 'follower', 'candidate', 'leader', 'log', 'RequestVote', 'AppendEntries'].map((name) => ({ name })),
    flags: { ...F, protocol: true, stateMachine: true },
  },
  '1.2': {
    summary: 'Listing 1.1 is a binary search that halves the range on every step; its loop invariant keeps the target between lo and hi.',
    defines: [
      { name: 'binary search', evidence: ev(1, 'Listing 1.1 Binary search') },
      { name: 'loop invariant', evidence: ev(6, 'the loop invariant is that the target, if present, lies between lo and hi.') },
    ],
    uses: [{ name: 'search' }],
    flags: { ...F, algorithm: true, codeHeavy: true },
  },
  ch2: { summary: 'The chapter recalls the search of Chapter 1 and covers formulas and figures.', defines: [], uses: [{ name: 'search' }], flags: F },
  '2.1': {
    summary: 'The number of steps of the search is bounded by floor(log2 n) + 1, where n is the number of items. A quorum needs more than n/2 votes.',
    defines: [{ name: 'quorum', evidence: ev(2, 'A quorum needs q>n2 votes.') }],
    uses: [{ name: 'binary search' }],
    flags: { ...F, math: true },
  },
  '2.2': {
    summary: 'Figure 2.1 shows a cluster of three servers and Figure 2.2 a log with five entries.',
    defines: [],
    uses: [{ name: 'cluster' }, { name: 'log' }, { name: 'server' }],
    flags: F,
  },
  '2.3.1': { summary: 'A test section: its empty parent heading is merged into it for generation.', defines: [], uses: [], flags: { ...F, narrative: true } },
  long1: {
    summary: LONG_SUMMARY,
    defines: [
      { name: 'replicated log', evidence: ev(0, 'A replicated log keeps every server in agreement about the order of commands.') },
      { name: 'heartbeat', evidence: ev(0, 'The leader sends heartbeats so that followers know it is still alive.') },
      { name: 'snapshot', evidence: ev(1, 'Snapshots compact the log once its prefix has been applied everywhere.') },
    ],
    uses: LONG_USES,
    flags: { ...F, protocol: true, architecture: true, stateMachine: true },
  },
  long2: { summary: LONG_SUMMARY, defines: [], uses: LONG_USES, flags: { ...F, protocol: true, architecture: true, stateMachine: true } },
  long: { summary: LONG_SUMMARY, defines: [], uses: LONG_USES, flags: { ...F, protocol: true, architecture: true } },
  ch4: { summary: 'A one-sentence chapter that checks scripts inside the book never run.', defines: [], uses: [], flags: { ...F, narrative: true } },
}

export const GLOSSARY = { merges: [{ canonical: 'replicated log', aliases: ['log'] }] }

/** `early`: the 30% summary; `final`: at completion. */
export const BOOK_SUMMARY = {
  early: {
    summary: 'A synthetic test book. It introduces server states (follower, candidate, leader), the RequestVote and AppendEntries messages, a binary search in Python with its loop invariant, and a formula bounding the number of search steps.',
    conventions: ['Listings, tables and figures are numbered by chapter, e.g. Listing 1.1.', 'Code listings are in Python.'],
  },
  final: {
    summary: 'A synthetic test book. It introduces server states, the RequestVote and AppendEntries messages, a binary search with its loop invariant and a bound on its steps, and then explains replicated logs: heartbeats, elections, terms and snapshots.',
    conventions: ['Listings, tables and figures are numbered by chapter, e.g. Listing 1.1.', 'Code listings are in Python.'],
  },
}

const item = (planItemId: string, kind: string, intent: string, priority: number, animate: boolean, extra: Record<string, unknown> = {}) => ({
  planItemId,
  kind,
  intent,
  conceptIds: [],
  priority,
  animate,
  ...extra,
})

/** Planner answers by section (`sectionId` is filled in by the generator). */
export const PLANS: Partial<Record<SectionKey, { needsVisual: boolean; reason: string; items: ReturnType<typeof item>[] }>> = {
  '1.1': {
    needsVisual: true,
    reason: 'Table 1.1 is a small data model of message types.',
    items: [item('p1', 'er', 'The message types of Table 1.1 with their sender and purpose', 1, false)],
  },
  '1.2': {
    needsVisual: true,
    reason: 'Listing 1.1 is an executable binary search over a sorted range.',
    items: [
      item('p1', 'graph', 'How lo, hi and mid define the binary search range', 1, false),
      item('p2', 'trace', 'Run the binary search of Listing 1.1 step by step', 2, false, { codeBlockId: '@b2' }),
    ],
  },
  '2.2': {
    needsVisual: true,
    reason: 'Figure 2.2 explicitly describes a log with five entries.',
    items: [item('p1', 'template', 'The five entries of the log in Figure 2.2', 1, false, { templateId: 'array' })],
  },
  '2.1': {
    needsVisual: true,
    reason: 'A formula with two named terms and a logarithmic growth rate.',
    items: [
      item('p1', 'math', 'What steps and n mean in the bound on search steps', 1, false),
      item('p2', 'chart', 'How the number of search steps grows with the number of items', 2, false),
    ],
  },
  long1: {
    needsVisual: true,
    reason: 'The section describes the parts of a replicated log, the follower-to-election change and the contents of a log entry.',
    items: [
      item('p1', 'graph', 'How the leader, followers, replicated log, state machine and snapshots relate', 1, false),
      item('p2', 'state', 'A follower that misses heartbeats starts an election', 2, false),
      item('p3', 'class', 'What a log entry carries', 3, false),
    ],
  },
  long2: {
    needsVisual: true,
    reason: 'Heartbeats and rejected entries are messages between leader and followers over time.',
    items: [
      item('p1', 'sequence', 'Leader heartbeats to followers and followers rejecting mismatched entries', 1, true),
      item('p2', 'timeline', 'Leader and follower activity when heartbeats stop', 2, true),
    ],
  },
  ch4: { needsVisual: false, reason: 'A single test sentence with nothing technical to draw.', items: [] },
}

/** Extractor answers by section and plan item. */
export const EXTRACTS: Record<string, unknown> = {
  '1.1|p1': {
    type: 'er',
    title: 'Message types',
    entities: [
      {
        id: 'message',
        label: 'Message',
        attributes: [
          { name: 'Sender', evidence: ev(5, 'Message Sender Purpose RequestVote candidate') },
          { name: 'Purpose', evidence: ev(5, 'Message Sender Purpose RequestVote candidate') },
        ],
        evidence: ev(4, 'Table 1.1 Message types'),
      },
      { id: 'server', label: 'Server', attributes: [], evidence: ev(0, 'A server can be in three states:') },
    ],
    relationships: [
      {
        id: 'sentBy',
        from: 'message',
        to: 'server',
        fromCardinality: 'zero-or-more',
        toCardinality: 'exactly-one',
        label: 'Sender',
        identifying: false,
        evidence: ev(5, 'Message Sender Purpose RequestVote candidate ask for a vote'),
      },
    ],
  },
  '1.2|p1': {
    type: 'graph',
    title: 'Binary search range',
    direction: 'LR',
    nodes: [
      { id: 'lo', label: 'lo', shape: 'box', evidence: ev(2, 'mid = (lo + hi) // 2') },
      { id: 'hi', label: 'hi', shape: 'box', evidence: ev(2, 'mid = (lo + hi) // 2') },
      { id: 'mid', label: 'mid', shape: 'box', evidence: ev(2, 'mid = (lo + hi) // 2') },
    ],
    edges: [
      { id: 'lo-mid', from: 'lo', to: 'mid', style: 'solid', evidence: ev(2, 'mid = (lo + hi) // 2') },
      { id: 'hi-mid', from: 'hi', to: 'mid', style: 'solid', evidence: ev(2, 'mid = (lo + hi) // 2') },
    ],
    groups: [],
  },
  '2.2|p1': {
    type: 'template',
    templateId: 'array',
    props: { label: 'Log', values: ['entry', 'entry', 'entry', 'entry', 'entry'] },
    evidence: [{ path: 'values', evidence: ev(1, 'Figure 2.2 A log with five entries') }],
  },
  '2.1|p1': {
    type: 'math',
    sourceBlockId: '@b1',
    terms: [
      { symbol: 'steps', meaning: 'the number of steps of the search', evidence: ev(0, 'The number of steps of the search in Listing 1.1 is bounded by the formula below.') },
      { symbol: 'n', meaning: 'the number of items', evidence: ev(2, 'Here n is the number of items.') },
    ],
  },
  '2.1|p2': {
    type: 'chart',
    title: 'Search steps',
    xLabel: 'items (n)',
    yLabel: 'steps',
    domain: [1, 1024],
    series: [{ name: 'steps', fn: 'log', evidence: ev(0, 'The number of steps of the search in Listing 1.1 is bounded by the formula below.') }],
    logY: false,
  },
  'long1|p1': {
    type: 'graph',
    title: 'A replicated log',
    direction: 'LR',
    nodes: [
      { id: 'leader', label: 'Leader', shape: 'box', evidence: ev(0, 'The leader sends heartbeats so that followers know it is still alive.') },
      { id: 'follower', label: 'Follower', shape: 'box', evidence: ev(0, 'The leader sends heartbeats so that followers know it is still alive.') },
      { id: 'log', label: 'Replicated log', shape: 'store', evidence: ev(0, 'A replicated log keeps every server in agreement about the order of commands.') },
      { id: 'server', label: 'Server', shape: 'box', evidence: ev(0, 'Each server applies committed commands to its state machine in log order.') },
      { id: 'sm', label: 'State machine', shape: 'store', evidence: ev(0, 'Each server applies committed commands to its state machine in log order.') },
      { id: 'snapshot', label: 'Snapshot', shape: 'store', evidence: ev(1, 'Snapshots compact the log once its prefix has been applied everywhere.') },
    ],
    edges: [
      { id: 'e1', from: 'leader', to: 'follower', label: 'heartbeats', style: 'dashed', evidence: ev(0, 'The leader sends heartbeats so that followers know it is still alive.') },
      { id: 'e2', from: 'log', to: 'server', label: 'order of commands', style: 'solid', evidence: ev(0, 'A replicated log keeps every server in agreement about the order of commands.') },
      { id: 'e3', from: 'server', to: 'sm', label: 'applies committed commands', style: 'solid', evidence: ev(0, 'Each server applies committed commands to its state machine in log order.') },
      { id: 'e4', from: 'snapshot', to: 'log', label: 'compacts', style: 'solid', evidence: ev(1, 'Snapshots compact the log once its prefix has been applied everywhere.') },
    ],
    groups: [],
  },
  'long1|p2': {
    type: 'state',
    title: 'Follower and election',
    initial: 'follower',
    final: [],
    states: [
      { id: 'follower', label: 'Follower', evidence: ev(0, 'When a follower misses heartbeats it starts an election for a new term.') },
      { id: 'election', label: 'Election', evidence: ev(0, 'it starts an election for a new term.') },
    ],
    transitions: [
      { id: 't1', from: 'follower', to: 'election', event: 'misses heartbeats', evidence: ev(0, 'When a follower misses heartbeats it starts an election for a new term.') },
    ],
  },
  'long1|p3': {
    type: 'class',
    title: 'Log entry',
    classes: [
      {
        id: 'entry',
        label: 'Log entry',
        fields: [{ name: 'term', evidence: ev(0, 'A log entry carries the term in which the leader received it.') }],
        methods: [],
        evidence: ev(0, 'A log entry carries the term in which the leader received it.'),
      },
    ],
    relations: [],
  },
  'long2|p1': {
    type: 'sequence',
    title: 'Heartbeats and rejected entries',
    participants: [
      { id: 'leader', label: 'Leader', evidence: ev(2, 'The leader sends heartbeats so that followers know it is still alive.') },
      { id: 'follower', label: 'Follower', evidence: ev(0, 'Followers reject entries that do not match the previous index and term.') },
    ],
    messages: [
      { id: 'm1', from: 'leader', to: 'follower', label: 'heartbeat', kind: 'async', evidence: ev(2, 'The leader sends heartbeats so that followers know it is still alive.') },
      { id: 'm2', from: 'follower', to: 'leader', label: 'reject entries', kind: 'reply', evidence: ev(0, 'Followers reject entries that do not match the previous index and term.') },
    ],
  },
  'long2|p2': {
    type: 'timeline',
    simulated: true,
    lanes: [{ id: 'leader', label: 'Leader' }, { id: 'follower', label: 'Follower' }],
    events: [
      { id: 'e1', lane: 'leader', at: 1, label: 'send heartbeats', to: 'follower', evidence: ev(2, 'The leader sends heartbeats so that followers know it is still alive.') },
      { id: 'e2', lane: 'follower', at: 2, label: 'misses heartbeats', evidence: ev(2, 'When a follower misses heartbeats it starts an election for a new term.') },
      { id: 'e3', lane: 'follower', at: 3, label: 'starts an election', evidence: ev(2, 'it starts an election for a new term.') },
    ],
  },
}
