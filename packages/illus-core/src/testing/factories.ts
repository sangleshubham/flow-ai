// Valid-by-construction factories for every schema. Each takes shallow overrides and parses the result,
// so a test that passes bad overrides fails loudly. Evidence quotes are verbatim from the small book.
import { makeConceptId, makeConceptModelId } from '../ids/index.ts'
import { AnimationIR, FrameState, emptyFrame, Step } from '../schemas/animation.ts'
import { Block, BookMeta, BookSummary, CrossRef, SectionNode } from '../schemas/book.ts'
import type { Evidence as EvidenceT } from '../schemas/common.ts'
import { Evidence } from '../schemas/common.ts'
import { ConceptModel, Patch, PatchOutput } from '../schemas/concept-model.ts'
import {
  Concept,
  ConceptMerge,
  GlossaryOutput,
  IndexerOutput,
  SectionIndex,
  SectionIndexOutput,
  SectionIndexRecord,
} from '../schemas/concepts.ts'
import {
  ChartIR,
  ClassIR,
  ErIR,
  GraphIR,
  HtmlIR,
  MathIR,
  SequenceIR,
  StateIR,
  TemplateIR,
  TimelineIR,
} from '../schemas/ir.ts'
import { LlmRequest, LlmResponse } from '../schemas/llm.ts'
import { PlanItem, PlanRecord, VisualPlan } from '../schemas/plan.ts'
import { ThemeTokens } from '../schemas/ports.ts'
import { CriticReport, ValidationReport } from '../schemas/quality.ts'
import { ElementReport, LlmLogEntry, SettingRecord, VisualRecord } from '../schemas/records.ts'
import { RawTrace, ScenarioTrace, Trace, TraceRecord, TraceStep, Translation } from '../schemas/trace.ts'

import {
  CHAPTER_ID,
  SECTION_COMMIT_ID as C,
  SECTION_LEADERS_ID as L,
  SMALL_BOOK_ID,
  SMALL_BOOK_TITLE,
  sb,
  smallBookBlocks,
} from './small-book.ts'

/** Fixed clock for deterministic records. */
export const FIXED_NOW = 1_760_000_000_000
const FAKE_HASH = 'a'.repeat(64)

/** Evidence from the small book. */
export function ev(blockId: string, quote: string): EvidenceT {
  return Evidence.parse({ blockId, quote })
}

/** Named verbatim quotes from the small book. */
export const Q = {
  request: ev(sb(L, 0), 'The leader accepts client requests'),
  append: ev(sb(L, 0), 'appends each command to its log as a new entry'),
  appendEntries: ev(sb(L, 1), 'sends AppendEntries messages to every follower in parallel'),
  followerAppends: ev(sb(L, 2), 'A follower appends the entries to its own log'),
  reply: ev(sb(L, 2), 'replies to the leader with a success flag'),
  threeStates: ev(sb(L, 3), 'A server is always in one of three states: follower, candidate or leader.'),
  noHeartbeat: ev(sb(L, 3), 'A follower that hears no heartbeat becomes a candidate and starts an election.'),
  majorityVotes: ev(sb(L, 3), 'A candidate that receives votes from a majority becomes the leader.'),
  entryFields: ev(sb(L, 4), 'Each log entry stores a term number and a command'),
  serverStores: ev(sb(L, 4), 'every server stores many log entries'),
  committed: ev(sb(C, 0), 'An entry is committed once the leader has replicated it on a majority of servers.'),
  logReceiver: ev(sb(C, 1), 'func (l *Log) advanceCommit(matchIndex []int) {'),
  majorityLine: ev(sb(C, 1), 'majority := matchIndex[len(matchIndex)/2]'),
  commitAssign: ev(sb(C, 1), 'l.commitIndex = majority'),
  figure: ev(sb(C, 3), 'The commit index advances when a majority has the entry.'),
} as const

const LEADER_CONCEPT = makeConceptId(SMALL_BOOK_ID, 'leader')

const firstBlock = (sectionId: string) => smallBookBlocks().find((b) => b.sectionId === sectionId)!

export const make = {
  evidence: (o: Partial<EvidenceT> = {}) => Evidence.parse({ ...Q.request, ...o }),

  // ------------------------------------------------------------ book structure
  block: (o: Partial<Block> = {}) => Block.parse({ ...firstBlock(L), ...o }),
  sectionNode: (o: Partial<SectionNode> = {}) =>
    SectionNode.parse({
      sectionId: L,
      bookId: SMALL_BOOK_ID,
      spineIndex: 2,
      spineHref: 'OEBPS/ch05.xhtml',
      ordinal: 1,
      level: 2,
      number: '5.1',
      title: 'Leaders and Followers',
      headingPath: ['5 Log Replication', '5.1 Leaders and Followers'],
      parentId: CHAPTER_ID,
      childIds: [],
      blockIds: [0, 1, 2, 3, 4].map((n) => sb(L, n)),
      cfiStart: 'epubcfi(/6/6!/4/2)',
      cfiEnd: 'epubcfi(/6/6!/4/12)',
      contentHash: FAKE_HASH,
      tokenEstimate: 120,
      ...o,
    }),
  crossRef: (o: Partial<CrossRef> = {}) =>
    CrossRef.parse({
      fromBlockId: sb(C, 0),
      kind: 'textual',
      label: 'Listing 5.1',
      targetSectionId: C,
      targetBlockId: sb(C, 1),
      resolved: true,
      ...o,
    }),
  bookSummary: (o: Partial<BookSummary> = {}) =>
    BookSummary.parse({
      summary: 'A short example book about how servers keep a replicated log consistent.',
      conventions: ['Code listings are in Go.'],
      ...o,
    }),
  bookMeta: (o: Partial<BookMeta> = {}) =>
    BookMeta.parse({
      bookId: SMALL_BOOK_ID,
      title: SMALL_BOOK_TITLE,
      indexStatus: 'structural',
      indexVersion: 1,
      sectionCount: 3,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      ...o,
    }),

  // ------------------------------------------------------------ index and concepts
  sectionIndexOutput: (o: Partial<SectionIndexOutput> = {}) =>
    SectionIndexOutput.parse({
      sectionId: L,
      summary: 'The leader appends client commands to its log and replicates them to followers.',
      defines: [{ name: 'leader', evidence: Q.request }],
      uses: [{ name: 'log entry' }, { name: 'follower' }],
      flags: {
        algorithm: false,
        protocol: true,
        architecture: true,
        dataStructure: false,
        stateMachine: true,
        math: false,
        codeHeavy: false,
        narrative: false,
      },
      ...o,
    }),
  sectionIndex: (o: Partial<SectionIndex> = {}) =>
    SectionIndex.parse({
      ...make.sectionIndexOutput(),
      indexedWith: { model: 'gpt-6-luna', promptVersion: '1.0.0' },
      ...o,
    }),
  sectionIndexRecord: (o: Partial<SectionIndexRecord> = {}) =>
    SectionIndexRecord.parse({ ...make.sectionIndex(), bookId: SMALL_BOOK_ID, ...o }),
  indexerOutput: (o: Partial<IndexerOutput> = {}) =>
    IndexerOutput.parse({ sections: [make.sectionIndexOutput()], ...o }),
  concept: (o: Partial<Concept> = {}) =>
    Concept.parse({
      conceptId: LEADER_CONCEPT,
      bookId: SMALL_BOOK_ID,
      canonical: 'leader',
      aliases: ['leader server'],
      definedInSectionId: L,
      definition: Q.request,
      firstOrdinal: 1,
      usedInSectionIds: [L, C],
      spanning: false,
      ...o,
    }),
  conceptMerge: (o: Partial<ConceptMerge> = {}) =>
    ConceptMerge.parse({ canonical: 'log entry', aliases: ['entry', 'log entries'], ...o }),
  glossaryOutput: (o: Partial<GlossaryOutput> = {}) =>
    GlossaryOutput.parse({ merges: [make.conceptMerge()], ...o }),

  // ------------------------------------------------------------ plans
  planItem: (o: Partial<PlanItem> = {}) =>
    PlanItem.parse({
      planItemId: 'p1',
      kind: 'graph',
      intent: 'Show how the leader replicates client commands to followers',
      conceptIds: [LEADER_CONCEPT],
      priority: 1,
      animate: true,
      ...o,
    }),
  visualPlan: (o: Partial<VisualPlan> = {}) =>
    VisualPlan.parse({
      sectionId: L,
      needsVisual: true,
      reason: 'The section describes components exchanging messages.',
      items: [make.planItem()],
      ...o,
    }),
  planRecord: (o: Partial<PlanRecord> = {}) =>
    PlanRecord.parse({
      cacheKey: FAKE_HASH,
      bookId: SMALL_BOOK_ID,
      sectionId: L,
      plan: make.visualPlan(),
      partialContext: false,
      model: 'gpt-6.1-sol',
      effort: 'medium',
      promptVersion: '1.0.0',
      usageTokens: 900,
      createdAt: FIXED_NOW,
      stale: false,
      ...o,
    }),

  // ------------------------------------------------------------ IR
  graphIR: (o: Partial<GraphIR> = {}) =>
    GraphIR.parse({
      type: 'graph',
      title: 'Log replication',
      direction: 'LR',
      nodes: [
        { id: 'client', label: 'Client', shape: 'actor', evidence: Q.request },
        { id: 'leader', label: 'Leader', shape: 'box', evidence: Q.request },
        { id: 'log', label: 'Log', shape: 'store', evidence: Q.append },
        { id: 'follower', label: 'Follower', shape: 'box', evidence: Q.appendEntries },
      ],
      edges: [
        { id: 'e1', from: 'client', to: 'leader', label: 'request', style: 'solid', evidence: Q.request },
        { id: 'e2', from: 'leader', to: 'log', label: 'append', style: 'solid', evidence: Q.append },
        { id: 'e3', from: 'leader', to: 'follower', label: 'AppendEntries', style: 'solid', evidence: Q.appendEntries },
        { id: 'e4', from: 'follower', to: 'leader', label: 'reply', style: 'dashed', evidence: Q.reply },
      ],
      groups: [],
      ...o,
    }),
  sequenceIR: (o: Partial<SequenceIR> = {}) =>
    SequenceIR.parse({
      type: 'sequence',
      title: 'One replication round',
      participants: [
        { id: 'client', label: 'Client', evidence: Q.request },
        { id: 'leader', label: 'Leader', evidence: Q.request },
        { id: 'follower', label: 'Follower', evidence: Q.appendEntries },
      ],
      messages: [
        { id: 'm1', from: 'client', to: 'leader', label: 'request', kind: 'sync', evidence: Q.request },
        { id: 'm2', from: 'leader', to: 'follower', label: 'AppendEntries', kind: 'async', evidence: Q.appendEntries },
        { id: 'm3', from: 'follower', to: 'leader', label: 'success', kind: 'reply', evidence: Q.reply },
      ],
      ...o,
    }),
  stateIR: (o: Partial<StateIR> = {}) =>
    StateIR.parse({
      type: 'state',
      title: 'Server states',
      initial: 'follower',
      final: [],
      states: [
        { id: 'follower', label: 'Follower', evidence: Q.threeStates },
        { id: 'candidate', label: 'Candidate', evidence: Q.noHeartbeat },
        { id: 'leader', label: 'Leader', evidence: Q.majorityVotes },
      ],
      transitions: [
        { id: 't1', from: 'follower', to: 'candidate', event: 'no heartbeat', evidence: Q.noHeartbeat },
        { id: 't2', from: 'candidate', to: 'leader', event: 'majority of votes', evidence: Q.majorityVotes },
      ],
      ...o,
    }),
  classIR: (o: Partial<ClassIR> = {}) =>
    ClassIR.parse({
      type: 'class',
      title: 'Log types',
      classes: [
        {
          id: 'Log',
          label: 'Log',
          fields: [{ name: 'commitIndex', type: 'int', evidence: Q.commitAssign }],
          methods: [{ name: 'advanceCommit', params: 'matchIndex []int', visibility: '-', evidence: Q.logReceiver }],
          evidence: Q.logReceiver,
        },
        {
          id: 'LogEntry',
          label: 'LogEntry',
          fields: [
            { name: 'term', evidence: Q.entryFields },
            { name: 'command', evidence: Q.entryFields },
          ],
          methods: [],
          evidence: Q.entryFields,
        },
      ],
      relations: [
        {
          id: 'r1',
          from: 'Log',
          to: 'LogEntry',
          kind: 'composition',
          fromCardinality: '1',
          toCardinality: '0..*',
          evidence: Q.serverStores,
        },
      ],
      ...o,
    }),
  erIR: (o: Partial<ErIR> = {}) =>
    ErIR.parse({
      type: 'er',
      title: 'Servers and log entries',
      entities: [
        { id: 'server', label: 'Server', attributes: [], evidence: Q.serverStores },
        {
          id: 'logEntry',
          label: 'LogEntry',
          attributes: [
            { name: 'term', type: 'int', evidence: Q.entryFields },
            { name: 'command', type: 'string', evidence: Q.entryFields },
          ],
          evidence: Q.entryFields,
        },
      ],
      relationships: [
        {
          id: 'stores',
          from: 'server',
          to: 'logEntry',
          fromCardinality: 'exactly-one',
          toCardinality: 'zero-or-more',
          label: 'stores',
          identifying: false,
          evidence: Q.serverStores,
        },
      ],
      ...o,
    }),
  templateIR: (o: Partial<TemplateIR> = {}) =>
    TemplateIR.parse({
      type: 'template',
      templateId: 'array',
      props: { values: [1, 3, 3], pointers: [{ name: 'majority', index: 1 }] },
      evidence: [
        { path: 'values', evidence: Q.majorityLine },
        { path: 'pointers.0', evidence: Q.majorityLine },
      ],
      ...o,
    }),
  chartIR: (o: Partial<ChartIR> = {}) =>
    ChartIR.parse({
      type: 'chart',
      title: 'Messages per replication round',
      xLabel: 'followers',
      yLabel: 'AppendEntries messages',
      domain: [1, 9],
      series: [{ name: 'AppendEntries', fn: 'linear', evidence: Q.appendEntries }],
      logY: false,
      ...o,
    }),
  mathIR: (o: Partial<MathIR> = {}) =>
    MathIR.parse({
      type: 'math',
      sourceBlockId: sb(C, 2),
      terms: [{ symbol: 'n', meaning: 'number of servers', evidence: Q.committed }],
      ...o,
    }),
  timelineIR: (o: Partial<TimelineIR> = {}) =>
    TimelineIR.parse({
      type: 'timeline',
      simulated: true,
      lanes: [
        { id: 'leader', label: 'Leader' },
        { id: 'follower', label: 'Follower' },
      ],
      events: [
        { id: 'a1', lane: 'leader', at: 0, label: 'append', evidence: Q.append },
        { id: 'a2', lane: 'leader', at: 1, label: 'AppendEntries', to: 'follower', evidence: Q.appendEntries },
        { id: 'a3', lane: 'follower', at: 2, label: 'append', evidence: Q.followerAppends },
      ],
      ...o,
    }),
  htmlIR: (o: Partial<HtmlIR> = {}) =>
    HtmlIR.parse({
      type: 'html',
      html: '<p>Log replication</p>',
      reason: 'No template or diagram kind fits this explanation.',
      ...o,
    }),

  // ------------------------------------------------------------ animation
  step: (o: Partial<Step> = {}) =>
    Step.parse({
      id: 's1',
      narration: 'A client sends a request to the leader.',
      evidence: Q.request,
      actions: [
        { op: 'highlight', target: 'node:client', tone: 'focus' },
        { op: 'token', id: 'req', label: 'cmd', path: ['e1'] },
      ],
      ...o,
    }),
  animationIR: (o: Partial<AnimationIR> = {}) =>
    AnimationIR.parse({
      planItemId: 'p1',
      initialHidden: ['node:follower', 'edge:e3'],
      steps: [
        make.step(),
        make.step({
          id: 's2',
          narration: 'The leader sends AppendEntries to the follower.',
          evidence: Q.appendEntries,
          actions: [
            { op: 'unhighlight', target: 'all' },
            { op: 'reveal', target: 'node:follower' },
            { op: 'reveal', target: 'edge:e3' },
            { op: 'highlight', target: 'edge:e3', tone: 'focus' },
          ],
        }),
      ],
      ...o,
    }),
  frameState: (o: Partial<FrameState> = {}) =>
    FrameState.parse({
      ...emptyFrame(['node:follower', 'edge:e3']),
      step: 1,
      stepId: 's1',
      narration: 'A client sends a request to the leader.',
      evidence: Q.request,
      highlights: { 'node:client': 'focus' },
      tokens: [{ id: 'req', label: 'cmd', path: ['e1'] }],
      ...o,
    }),

  // ------------------------------------------------------------ tracer
  translation: (o: Partial<Translation> = {}) =>
    Translation.parse({
      traceable: true,
      python: [
        'def advance_commit(match_index, commit_index):',
        '    match_index = sorted(match_index)',
        '    majority = match_index[len(match_index) // 2]',
        '    if majority > commit_index:',
        '        commit_index = majority',
        '    return commit_index',
      ].join('\n'),
      scenarios: [{ label: 'advances', entry: 'advance_commit([3, 1, 3], 1)' }],
      inputRationale: 'Two of three servers have entry 3, so the commit index moves from 1 to 3.',
      lineMap: [
        { py: 1, orig: [1] },
        { py: 2, orig: [2] },
        { py: 3, orig: [3] },
        { py: 4, orig: [4] },
        { py: 5, orig: [5] },
        { py: 6, orig: [7] },
      ],
      focusFunctions: ['advance_commit'],
      vizHints: [{ variable: 'match_index', template: 'array', pointerOf: 'majority' }],
      assumptions: ['The Log receiver is modelled as an explicit commit_index argument.'],
      ...o,
    }),
  traceStep: (o: Partial<TraceStep> = {}) =>
    TraceStep.parse({
      i: 0,
      event: 'line',
      pyLine: 3,
      origLines: [3],
      frames: [{ fn: 'advance_commit', locals: { match_index: { ref: 'o1' }, commit_index: { prim: 1 } } }],
      heap: { o1: { kind: 'list', items: [{ prim: 1 }, { prim: 3 }, { prim: 3 }] } },
      stdout: '',
      ...o,
    }),
  rawTrace: (o: Partial<RawTrace> = {}) => RawTrace.parse({ steps: [make.traceStep()], truncated: false, ...o }),
  trace: (o: Partial<Trace> = {}) =>
    Trace.parse({
      codeBlockId: sb(C, 1),
      python: make.translation().python,
      lineMap: make.translation().lineMap,
      input: 'advance_commit([3, 1, 3], 1)',
      assumptions: make.translation().assumptions,
      steps: [
        make.traceStep(),
        make.traceStep({ i: 1, event: 'return', pyLine: 6, origLines: [7], returnValue: { prim: 3 } }),
      ],
      truncated: false,
      ...o,
    }),
  scenarioTrace: (o: Partial<ScenarioTrace> = {}) => ScenarioTrace.parse({ label: 'advances', trace: make.trace(), ...o }),
  traceRecord: (o: Partial<TraceRecord> = {}) =>
    TraceRecord.parse({
      cacheKey: FAKE_HASH,
      bookId: SMALL_BOOK_ID,
      codeBlockId: sb(C, 1),
      translation: make.translation(),
      scenarios: [make.scenarioTrace()],
      mode: 'executed',
      promptVersions: { translator: '1.0.0' },
      models: { translator: 'gpt-6.1-sol' },
      efforts: { translator: 'high' },
      createdAt: FIXED_NOW,
      stale: false,
      ...o,
    }),

  // ------------------------------------------------------------ concept models
  patchOutput: (o: Partial<PatchOutput> = {}) =>
    PatchOutput.parse({
      ops: [
        { op: 'addNode', node: make.graphIR().nodes[1] },
        { op: 'addNode', node: make.graphIR().nodes[3] },
        { op: 'addEdge', edge: make.graphIR().edges[2] },
      ],
      ...o,
    }),
  patch: (o: Partial<Patch> = {}) =>
    Patch.parse({
      patchId: `${makeConceptModelId(LEADER_CONCEPT, 'graph')}@${L}`,
      sectionId: L,
      sectionOrdinal: 1,
      ops: make.patchOutput().ops,
      createdWith: { model: 'gpt-6.1-sol', promptVersion: '1.0.0' },
      ...o,
    }),
  conceptModel: (o: Partial<ConceptModel> = {}) =>
    ConceptModel.parse({
      conceptModelId: makeConceptModelId(LEADER_CONCEPT, 'graph'),
      conceptId: LEADER_CONCEPT,
      bookId: SMALL_BOOK_ID,
      kind: 'graph',
      patches: [make.patch()],
      ...o,
    }),

  // ------------------------------------------------------------ quality and records
  validationReport: (o: Partial<ValidationReport> = {}) =>
    ValidationReport.parse({
      ok: true,
      groundingScore: 1,
      counts: { total: 8, grounded: 8, halfGrounded: 0, fuzzy: 0, dropped: 0 },
      dropped: [],
      issues: [],
      retried: false,
      escalated: false,
      ...o,
    }),
  criticReport: (o: Partial<CriticReport> = {}) =>
    CriticReport.parse({ pass: true, scores: { legibility: 4, intentMatch: 4, clutter: 4 }, issues: [], ...o }),
  elementReport: (o: Partial<ElementReport> = {}) =>
    ElementReport.parse({ elementId: 'e4', evidence: Q.reply, note: 'Replies go to the leader only.', createdAt: FIXED_NOW, ...o }),
  visualRecord: (o: Partial<VisualRecord> = {}) =>
    VisualRecord.parse({
      cacheKey: 'b'.repeat(64),
      bookId: SMALL_BOOK_ID,
      sectionId: L,
      planItemId: 'p1',
      kind: 'graph',
      ir: make.graphIR(),
      spec: null,
      animation: make.animationIR(),
      validation: make.validationReport(),
      critic: make.criticReport(),
      promptVersions: { planner: '1.0.0', 'extractor.graph': '1.0.0', animator: '1.0.0' },
      models: { planner: 'gpt-6.1-sol@medium', 'extractor.graph': 'gpt-6.1-sol@medium', animator: 'gpt-6.1-sol@medium' },
      usageTokens: 5200,
      createdAt: FIXED_NOW,
      stale: false,
      ...o,
    }),
  llmLogEntry: (o: Partial<LlmLogEntry> = {}) =>
    LlmLogEntry.parse({
      requestId: 'req-1',
      role: 'planner',
      promptVersion: '1.0.0',
      model: 'gpt-6.1-sol',
      effort: 'medium',
      inputTokens: 4000,
      outputTokens: 600,
      cachedInputTokens: 2500,
      latencyMs: 3100,
      outcome: 'ok',
      bookId: SMALL_BOOK_ID,
      sectionId: L,
      createdAt: FIXED_NOW,
      ...o,
    }),
  settingRecord: (o: Partial<SettingRecord> = {}) => SettingRecord.parse({ key: 'flags', value: { templates: true }, ...o }),
  llmRequest: (o: Partial<LlmRequest> = {}) =>
    LlmRequest.parse({
      role: 'planner',
      promptVersion: '1.0.0',
      prefix: '<book_context>…</book_context>',
      body: '<section id="…">…</section>',
      schemaName: 'VisualPlan',
      requestId: 'req-1',
      ...o,
    }),
  llmResponse: (o: Partial<Extract<LlmResponse, { ok: true }>> = {}) =>
    LlmResponse.parse({
      ok: true,
      data: make.visualPlan(),
      usage: { input: 4000, output: 600, cachedInput: 2500 },
      model: 'gpt-6.1-sol',
      effort: 'medium',
      latencyMs: 3100,
      ...o,
    }),
  themeTokens: (o: Partial<ThemeTokens> = {}) =>
    ThemeTokens.parse({
      bg: '#ffffff',
      fg: '#1f2328',
      muted: '#6e7781',
      line: '#d0d7de',
      accent: '#0ea5e9',
      new: '#0ea5e9',
      earlier: '#8c959f',
      highlight: 'rgba(3, 102, 214, 0.2)',
      font: 'Inter, system-ui, sans-serif',
      mono: 'ui-monospace, monospace',
      dark: false,
      ...o,
    }),
}
