// A tiny, original (non-copyrighted) two-section book used by every factory, so evidence quotes in the
// factory IRs are verbatim substrings of real block text and grounding tests can use them as-is.
import { makeBlockId, makeSectionId } from '../ids/index.ts'
import type { Block, BlockKind } from '../schemas/book.ts'

export const SMALL_BOOK_ID = '0123456789abcdef'
export const SMALL_BOOK_TITLE = 'Replicated Logs, A Small Example'

export const CHAPTER_ID = makeSectionId({
  bookId: SMALL_BOOK_ID,
  spineIndex: 2,
  headingPath: ['5 Log Replication'],
  ordinalInSpine: 0,
})
export const SECTION_LEADERS_ID = makeSectionId({
  bookId: SMALL_BOOK_ID,
  spineIndex: 2,
  headingPath: ['5 Log Replication', '5.1 Leaders and Followers'],
  ordinalInSpine: 1,
})
export const SECTION_COMMIT_ID = makeSectionId({
  bookId: SMALL_BOOK_ID,
  spineIndex: 2,
  headingPath: ['5 Log Replication', '5.2 Committing Entries'],
  ordinalInSpine: 2,
})

interface BlockSeed {
  kind: BlockKind
  text: string
  label?: string
  code?: Block['code']
  figure?: Block['figure']
  math?: Block['math']
}

const COMMIT_SOURCE = [
  'func (l *Log) advanceCommit(matchIndex []int) {',
  '\tsort.Ints(matchIndex)',
  '\tmajority := matchIndex[len(matchIndex)/2]',
  '\tif majority > l.commitIndex {',
  '\t\tl.commitIndex = majority',
  '\t}',
  '}',
].join('\n')

export const SMALL_BOOK_BLOCKS: Record<string, BlockSeed[]> = {
  [CHAPTER_ID]: [
    {
      kind: 'paragraph',
      text: 'This chapter shows how a cluster of servers keeps one replicated log in agreement.',
    },
  ],
  [SECTION_LEADERS_ID]: [
    {
      kind: 'paragraph',
      text: 'The leader accepts client requests and appends each command to its log as a new entry.',
    },
    {
      kind: 'paragraph',
      text: 'The leader then sends AppendEntries messages to every follower in parallel.',
    },
    {
      kind: 'paragraph',
      text: 'A follower appends the entries to its own log and replies to the leader with a success flag.',
    },
    {
      kind: 'paragraph',
      text: 'A server is always in one of three states: follower, candidate or leader. A follower that hears no heartbeat becomes a candidate and starts an election. A candidate that receives votes from a majority becomes the leader.',
    },
    {
      kind: 'paragraph',
      text: 'Each log entry stores a term number and a command, and every server stores many log entries.',
    },
  ],
  [SECTION_COMMIT_ID]: [
    {
      kind: 'paragraph',
      text: 'An entry is committed once the leader has replicated it on a majority of servers.',
    },
    {
      kind: 'code',
      label: 'Listing 5.1',
      text: COMMIT_SOURCE,
      code: { source: COMMIT_SOURCE, langHint: 'go' },
    },
    {
      kind: 'math',
      text: 'majority = floor(n / 2) + 1',
      math: { tex: '\\lfloor n/2 \\rfloor + 1' },
    },
    {
      kind: 'figure',
      label: 'Figure 5.2',
      text: 'Figure 5.2 The commit index advances when a majority has the entry.',
      figure: { caption: 'Figure 5.2 The commit index advances when a majority has the entry.', imgHref: 'images/commit.png' },
    },
  ],
}

/** Blocks of the small book as full `Block` objects, in reading order. */
export function smallBookBlocks(): Block[] {
  return Object.entries(SMALL_BOOK_BLOCKS).flatMap(([sectionId, seeds]) =>
    seeds.map((seed, n) => ({
      blockId: makeBlockId(sectionId, n),
      sectionId,
      cfiRange: `epubcfi(/6/6!/4/${2 * (n + 1)},/1:0,/1:${seed.text.length})`,
      ...seed,
    })),
  )
}

/** Block id of block `n` in a small-book section. */
export function sb(sectionId: string, n: number): string {
  return makeBlockId(sectionId, n)
}
