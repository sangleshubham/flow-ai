// A 5-section Raft-like fixture book (original text, CC0) whose `leader` concept grows one graph model,
// plus the hand-written "oracle" patcher that answers like a careful model: it adds the elements a
// section describes that the concept model in slot 7 does not have yet.
import { makeBlockId, makeConceptId, makeConceptModelId, makeSectionId, sectionContentHash } from '@illus/core'
import type { Block, IllusRepos, PatchOp, PatchOutput, SectionNode } from '@illus/core'
import { createMemoryRepos, make } from '@illus/core/testing'

export const BOOK_ID = 'feedc0de00000006'
const CHAPTER = '6 Replicated State Machines'

interface SectionSeed {
  title: string
  summary: string
  blocks: string[]
}

export const SECTIONS: SectionSeed[] = [
  {
    title: '6.1 Servers and Roles',
    summary: 'One server of the cluster is the leader; the others are followers, and clients talk only to the leader.',
    blocks: [
      'A cluster runs several servers, and exactly one of them acts as the leader at any time.',
      'The other servers are followers that respond to requests from the leader.',
      'Clients send every request to the leader, never to a follower.',
    ],
  },
  {
    title: '6.2 Log Replication',
    summary: 'The leader appends commands to its log and replicates them to the followers with AppendEntries.',
    blocks: [
      'The leader appends each client command to its log.',
      'It then sends AppendEntries messages to every follower.',
      'Each follower writes the entries to its own log and acknowledges them.',
    ],
  },
  {
    title: '6.3 Elections',
    summary: 'A follower that times out becomes a candidate and asks for votes; a majority makes it leader.',
    blocks: [
      'A follower that hears nothing from the leader for an election timeout becomes a candidate.',
      'The candidate sends RequestVote messages to the other servers and waits for their votes.',
      'A candidate that wins votes from a majority becomes the new leader.',
    ],
  },
  {
    title: '6.4 Commitment',
    summary: 'The leader tracks a commit index; committed entries are applied to the state machine.',
    blocks: [
      'The leader tracks a commit index, the highest log entry stored on a majority of servers.',
      'Once an entry is committed, every server applies it to its state machine.',
    ],
  },
  {
    title: '6.5 Snapshots',
    summary: 'Servers compact their logs into snapshots; the leader sends snapshots to lagging followers.',
    blocks: [
      'To keep the log short, each server compacts committed entries into a snapshot.',
      'A leader sends InstallSnapshot to a follower that has fallen too far behind.',
    ],
  },
]

export const CHAPTER_ID = makeSectionId({ bookId: BOOK_ID, spineIndex: 1, headingPath: [CHAPTER], ordinalInSpine: 0 })
export const SECTION_IDS = SECTIONS.map((s, i) =>
  makeSectionId({ bookId: BOOK_ID, spineIndex: 1, headingPath: [CHAPTER, s.title], ordinalInSpine: i + 1 }),
)
export const CONCEPT_ID = makeConceptId(BOOK_ID, 'leader')
export const MODEL_ID = makeConceptModelId(CONCEPT_ID, 'graph')

/** Evidence from block `b` of section `s` (1-based section number). */
const ev = (s: number, b: number, quote: string) => {
  const blockId = makeBlockId(SECTION_IDS[s - 1]!, b)
  if (!SECTIONS[s - 1]!.blocks[b]!.includes(quote)) throw new Error(`fixture quote not verbatim: ${quote}`)
  return { blockId, quote }
}
const node = (s: number, b: number, quote: string, id: string, label: string, shape: 'box' | 'store' | 'actor' = 'box', group?: string): PatchOp => ({
  op: 'addNode',
  node: { id, label, shape, evidence: ev(s, b, quote), ...(group && { group }) },
})
const edge = (s: number, b: number, quote: string, id: string, from: string, to: string, label: string, style: 'solid' | 'dashed' = 'solid'): PatchOp => ({
  op: 'addEdge',
  edge: { id, from, to, label, style, evidence: ev(s, b, quote) },
})

/** What each section describes, in the order a careful patcher would add it (each list ≤ 8 ops). */
export const DESCRIBED: PatchOp[][] = [
  [
    { op: 'addGroup', group: { id: 'cluster', label: 'Cluster', evidence: ev(1, 0, 'A cluster runs several servers') } },
    node(1, 0, 'one of them acts as the leader', 'leader', 'Leader', 'box', 'cluster'),
    node(1, 1, 'The other servers are followers', 'follower', 'Follower', 'box', 'cluster'),
    node(1, 2, 'Clients send every request to the leader', 'client', 'Client', 'actor'),
    edge(1, 2, 'Clients send every request to the leader', 'e-request', 'client', 'leader', 'request'),
    edge(1, 1, 'followers that respond to requests from the leader', 'e-respond', 'follower', 'leader', 'respond', 'dashed'),
  ],
  [
    node(2, 0, 'The leader appends each client command', 'leader', 'Leader'),
    node(2, 1, 'sends AppendEntries messages to every follower', 'follower', 'Follower'),
    node(2, 0, 'appends each client command to its log', 'leader-log', 'Leader log', 'store'),
    edge(2, 0, 'appends each client command to its log', 'e-append', 'leader', 'leader-log', 'append'),
    edge(2, 1, 'sends AppendEntries messages to every follower', 'e-appendentries', 'leader', 'follower', 'AppendEntries'),
    node(2, 2, 'writes the entries to its own log', 'follower-log', 'Follower log', 'store'),
    edge(2, 2, 'writes the entries to its own log', 'e-write', 'follower', 'follower-log', 'write'),
  ],
  [
    node(3, 0, 'hears nothing from the leader', 'leader', 'Leader'),
    node(3, 0, 'A follower that hears nothing', 'follower', 'Follower'),
    node(3, 0, 'for an election timeout becomes a candidate', 'candidate', 'Candidate'),
    edge(3, 0, 'for an election timeout becomes a candidate', 'e-timeout', 'follower', 'candidate', 'election timeout'),
    edge(3, 1, 'sends RequestVote messages to the other servers', 'e-requestvote', 'candidate', 'follower', 'RequestVote'),
    edge(3, 2, 'wins votes from a majority becomes the new leader', 'e-wins', 'candidate', 'leader', 'wins a majority'),
  ],
  [
    node(4, 0, 'The leader tracks a commit index', 'leader', 'Leader'),
    node(4, 0, 'The leader tracks a commit index', 'commit-index', 'Commit index'),
    edge(4, 0, 'The leader tracks a commit index', 'e-tracks', 'leader', 'commit-index', 'tracks'),
    node(4, 1, 'applies it to its state machine', 'state-machine', 'State machine', 'store'),
    edge(4, 1, 'Once an entry is committed, every server applies it', 'e-apply', 'commit-index', 'state-machine', 'apply committed'),
    { op: 'annotate', id: 'commit-index', text: 'highest entry on a majority', evidence: ev(4, 0, 'the highest log entry stored on a majority of servers') },
  ],
  [
    node(5, 1, 'A leader sends InstallSnapshot', 'leader', 'Leader'),
    node(5, 1, 'a follower that has fallen too far behind', 'follower', 'Follower'),
    node(5, 0, 'To keep the log short', 'leader-log', 'Leader log', 'store'),
    node(5, 0, 'compacts committed entries into a snapshot', 'snapshot', 'Snapshot', 'store'),
    edge(5, 0, 'compacts committed entries into a snapshot', 'e-compact', 'leader-log', 'snapshot', 'compact'),
    edge(5, 1, 'A leader sends InstallSnapshot to a follower', 'e-install', 'leader', 'follower', 'InstallSnapshot'),
  ],
]

/** Memory repos holding the fixture book, its index summaries and the spanning `leader` concept. */
export async function buildRaftBook(): Promise<{ repos: IllusRepos; sections: SectionNode[]; blocks: Block[] }> {
  const repos = createMemoryRepos()
  const blocks: Block[] = []
  const sections: SectionNode[] = []
  const chapterBlock: Block = { blockId: makeBlockId(CHAPTER_ID, 0), sectionId: CHAPTER_ID, kind: 'paragraph', text: 'This chapter builds a replicated state machine.', cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:10)' }
  blocks.push(chapterBlock)
  sections.push(
    make.sectionNode({
      sectionId: CHAPTER_ID, bookId: BOOK_ID, spineIndex: 1, spineHref: 'OEBPS/ch06.xhtml', ordinal: 0, level: 1, number: '6',
      title: 'Replicated State Machines', headingPath: [CHAPTER], childIds: SECTION_IDS, blockIds: [chapterBlock.blockId],
      contentHash: await sectionContentHash([chapterBlock.text]), tokenEstimate: 12,
    }),
  )
  delete sections[0]!.parentId
  for (const [i, s] of SECTIONS.entries()) {
    const sectionId = SECTION_IDS[i]!
    const own = s.blocks.map((text, n): Block => ({ blockId: makeBlockId(sectionId, n), sectionId, kind: 'paragraph', text, cfiRange: `epubcfi(/6/4!/4/${2 * (n + 1)},/1:0,/1:${text.length})` }))
    blocks.push(...own)
    sections.push(
      make.sectionNode({
        sectionId, bookId: BOOK_ID, spineIndex: 1, spineHref: 'OEBPS/ch06.xhtml', ordinal: i + 1, level: 2, number: s.title.split(' ')[0]!,
        title: s.title.slice(s.title.indexOf(' ') + 1), headingPath: [CHAPTER, s.title], parentId: CHAPTER_ID, childIds: [],
        blockIds: own.map((b) => b.blockId), contentHash: await sectionContentHash(s.blocks), tokenEstimate: 40,
        cfiStart: own[0]!.cfiRange, cfiEnd: own.at(-1)!.cfiRange,
      }),
    )
    await repos.sectionIndex.put(
      make.sectionIndexRecord({ sectionId, bookId: BOOK_ID, summary: s.summary, defines: [], uses: [{ name: 'leader' }] }),
    )
  }
  await repos.books.put(make.bookMeta({ bookId: BOOK_ID, title: 'Consensus, A Small Example', sectionCount: sections.length, indexStatus: 'complete' }))
  await repos.sections.bulkPut(sections)
  await repos.blocks.bulkPut(blocks)
  await repos.concepts.put(
    make.concept({
      conceptId: CONCEPT_ID, bookId: BOOK_ID, canonical: 'leader', aliases: [], definedInSectionId: SECTION_IDS[0]!,
      definition: ev(1, 0, 'one of them acts as the leader'), firstOrdinal: 1, usedInSectionIds: SECTION_IDS, spanning: true,
    }),
  )
  return { repos, sections, blocks }
}

/** The concept-model state the patcher was shown (slot 7). */
export function shownState(body: string): { ids: Set<string>; annotations: Set<string> } {
  const m = /<concept_model[^>]*>([\s\S]*?)<\/concept_model>/.exec(body)
  if (!m) throw new Error('patcher request without a <concept_model> slot')
  const state = JSON.parse(m[1]!.replace(/&lt;/g, '<')) as Record<string, unknown>
  const ids = new Set<string>()
  for (const v of Object.values(state)) if (Array.isArray(v)) for (const x of v as { id?: string; op?: string }[]) if (x.id && x.op !== 'annotate') ids.add(x.id)
  const annotations = new Set(((state.annotations ?? []) as { id: string; text: string }[]).map((a) => `${a.id}|${a.text}`))
  return { ids, annotations }
}

/** Answers like a careful patcher: the described elements that are missing from the shown state. */
export function oracle(sectionId: string, body: string): PatchOutput {
  const i = SECTION_IDS.indexOf(sectionId)
  if (i < 0) throw new Error(`no hand-written patch for ${sectionId}`)
  const { ids, annotations } = shownState(body)
  const ops: PatchOp[] = []
  for (const op of DESCRIBED[i]!) {
    if (op.op === 'annotate') {
      if (!annotations.has(`${op.id}|${op.text}`)) ops.push(op)
      continue
    }
    const el = op.op === 'addNode' ? op.node : op.op === 'addEdge' ? op.edge : op.op === 'addGroup' ? op.group : undefined
    if (!el || ids.has(el.id)) continue
    // A node whose group the model does not have yet is added ungrouped.
    if (op.op === 'addNode' && op.node.group && !ids.has(op.node.group)) {
      const { group: _g, ...n } = op.node
      ops.push({ op: 'addNode', node: n })
    } else ops.push(op)
    ids.add(el.id)
  }
  return { ops: ops.slice(0, 8) }
}
