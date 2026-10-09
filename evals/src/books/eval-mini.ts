// `eval-mini`: short original sections (CC0, written for this repo) covering golden-case categories the
// synthetic EPUB and the small book lack. Block text is already normalised the way the indexer stores it.
import { makeBlockId, makeSectionId } from '@illus/core'

import type { RunBlock } from '../case.ts'

export const EVAL_MINI_BOOK_ID = 'e7a1e7a1e7a1e7a1'

interface Seed {
  heading: string
  blocks: Omit<RunBlock, 'blockId'>[]
}

const SECTIONS: Seed[] = [
  {
    heading: '1 Stacks',
    blocks: [
      {
        kind: 'paragraph',
        text: 'A stack keeps its items in last-in, first-out order. The push operation places an item on top of the stack, and the pop operation removes the item that is currently on top.',
      },
      {
        kind: 'paragraph',
        text: 'Start with an empty stack and push 1, then 2, then 3. One pop removes 3, so the stack now holds 1 and 2, with 2 on top.',
      },
    ],
  },
  {
    heading: '2 Binary Search Trees',
    blocks: [
      {
        kind: 'paragraph',
        text: "In a binary search tree, every key in the left subtree of a node is smaller than the node's key, and every key in the right subtree is larger.",
      },
      {
        kind: 'paragraph',
        text: 'Inserting the keys 8, 3, 10, 1 and 6 in that order makes 8 the root. The key 3 becomes the left child of 8 and 10 becomes its right child. The key 1 becomes the left child of 3, and 6 becomes the right child of 3.',
      },
    ],
  },
  {
    heading: '3 Summing a List',
    blocks: [
      { kind: 'paragraph', text: 'The function in Listing 3.1 adds up the numbers in a list with a running total.' },
      { kind: 'code', text: 'def total(xs):\n    s = 0\n    for x in xs:\n        s += x\n    return s' },
      { kind: 'paragraph', text: 'Calling total([2, 4, 6]) returns 12.' },
    ],
  },
  {
    heading: '4 Job Lifecycle',
    blocks: [
      { kind: 'paragraph', text: 'A job starts in the queued state. When a worker picks it up, the job moves to running.' },
      {
        kind: 'paragraph',
        text: 'A running job that finishes moves to done. A running job that raises an error moves to failed. Retrying a failed job moves it back to queued.',
      },
    ],
  },
]

/** Sections of the eval-mini book: one spine item per section, each a single heading. */
export const EVAL_MINI_SECTIONS = SECTIONS.map((s, spineIndex) => {
  const sectionId = makeSectionId({ bookId: EVAL_MINI_BOOK_ID, spineIndex, headingPath: [s.heading], ordinalInSpine: 0 })
  return {
    sectionId,
    title: s.heading,
    blocks: s.blocks.map((b, n): RunBlock => ({ blockId: makeBlockId(sectionId, n), ...b })),
  }
})
