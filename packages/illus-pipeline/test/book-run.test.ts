// The whole-book run (ADR 0057): a fake pipeline whose handles are driven by hand and a fake concept pass.
import { LlmError } from '@illus/core'
import type { LlmCall, SectionNode } from '@illus/core'
import { createConceptPass } from '@illus/concepts'
import type { ConceptPassProgress } from '@illus/concepts'
import { createMemoryRepos, make } from '@illus/core/testing'
import { describe, expect, test, vi } from 'vitest'

import {
  BOOK_RUN_SECTIONS,
  MAX_FAILED_IN_A_ROW,
  REQUESTS_PER_SECTION,
  bookRunTargets,
  createBookRun,
  estimateBookRun,
} from '../src/index.ts'
import type {
  BookRunProgress,
  RequestOptions,
  SectionCacheState,
  SectionCacheStatus,
  SectionJob,
  SectionJobEvent,
  SectionJobEvents,
} from '../src/index.ts'

const section = (id: string, ordinal: number, o: Partial<SectionNode> = {}) =>
  make.sectionNode({ sectionId: id, ordinal, ...o })

/** A hand-driven handle: `emit` delivers to its listeners, `done` ends it. */
class FakeHandle implements SectionJob {
  cancelled = false
  readonly listeners = new Map<SectionJobEvent, ((p: never) => void)[]>()
  readonly finished: Promise<void>
  private resolve!: () => void
  readonly sectionId: string
  readonly opts: RequestOptions
  constructor(sectionId: string, opts: RequestOptions) {
    this.sectionId = sectionId
    this.opts = opts
    this.finished = new Promise((r) => (this.resolve = r))
  }
  on<E extends SectionJobEvent>(
    event: E,
    cb: (p: SectionJobEvents[E]) => void,
  ) {
    const list = this.listeners.get(event) ?? []
    list.push(cb as (p: never) => void)
    this.listeners.set(event, list)
    return () => list.splice(list.indexOf(cb as (p: never) => void), 1)
  }
  emit<E extends SectionJobEvent>(event: E, payload: SectionJobEvents[E]) {
    for (const cb of [...(this.listeners.get(event) ?? [])])
      cb(payload as never)
  }
  ended = false
  done(cancelled = false) {
    if (this.ended) return
    this.ended = true
    this.emit('done', { cancelled })
    this.resolve()
  }
  cancel() {
    if (this.cancelled) return
    this.cancelled = true
    queueMicrotask(() => this.done(true))
  }
}

function fakePipeline() {
  const handles: FakeHandle[] = []
  return {
    handles,
    /** Handles neither cancelled nor done. */
    open: () => handles.filter((h) => !h.cancelled && !h.ended),
    requestSection: vi.fn((id: string, opts: RequestOptions = {}) => {
      const h = new FakeHandle(id, opts)
      handles.push(h)
      return h
    }),
  }
}

const COMPLETE: ConceptPassProgress = { indexed: 3, total: 3, done: true }
const fakeConcepts = (result: ConceptPassProgress = COMPLETE) => ({
  start: vi.fn(async () => result),
})

/** Lets queued microtasks and promise continuations run. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

const BOOK = [
  section('c', 3),
  section('a', 1),
  section('merged', 2, { mergedInto: 'b' }),
  section('empty', 0, { blockIds: [] }),
  section('b', 2),
  section('d', 4),
]

describe('bookRunTargets', () => {
  test('skips merged sections and sections without blocks, in reading order', () => {
    expect(bookRunTargets(BOOK).map((s) => s.sectionId)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })

  test('does not reorder its input', () => {
    const input = [...BOOK]
    bookRunTargets(input)
    expect(input).toEqual(BOOK)
  })
})

describe('estimateBookRun', () => {
  test('requests per uncached section plus the indexing requests', () => {
    expect(REQUESTS_PER_SECTION).toBe(5)
    expect(estimateBookRun({ uncachedSections: 10, indexRequests: 7 })).toBe(57)
    expect(estimateBookRun({ uncachedSections: 0, indexRequests: 0 })).toBe(0)
    expect(estimateBookRun({ uncachedSections: -2, indexRequests: -1 })).toBe(0)
  })
})

describe('createBookRun (ADR 0057)', () => {
  test('two sections in flight by default', () => {
    expect(BOOK_RUN_SECTIONS).toBe(2)
  })

  test('awaits the concept pass before requesting any section', async () => {
    const pipeline = fakePipeline()
    let finishPass!: (p: ConceptPassProgress) => void
    const concepts = {
      start: vi.fn(
        () => new Promise<ConceptPassProgress>((r) => (finishPass = r)),
      ),
    }
    const seen: BookRunProgress[] = []
    const run = createBookRun({
      pipeline,
      concepts,
      sections: BOOK,
      onProgress: (p) => seen.push(p),
    })
    const result = run.start()
    await flush()
    expect(run.progress.status).toBe('understanding')
    expect(seen[0]).toMatchObject({
      status: 'understanding',
      total: 4,
      finished: 0,
    })
    expect(pipeline.requestSection).not.toHaveBeenCalled()
    finishPass(COMPLETE)
    await flush()
    expect(pipeline.requestSection).toHaveBeenCalledTimes(2)
    expect(run.progress).toMatchObject({
      status: 'illustrating',
      indexed: { indexed: 3, total: 3 },
    })
    for (const h of pipeline.handles) h.done()
    await flush()
    for (const h of pipeline.handles.slice(2)) h.done()
    expect(await result).toMatchObject({ status: 'done', finished: 4 })
  })

  test("the concept pass's plan limit pauses the run without requesting anything", async () => {
    const pipeline = fakePipeline()
    const concepts = fakeConcepts({
      indexed: 1,
      total: 3,
      done: false,
      error: new LlmError('plan-limit', 'limit', { retryAfterMs: 60_000 }),
    })
    const result = await createBookRun({
      pipeline,
      concepts,
      sections: BOOK,
    }).start()
    expect(result).toMatchObject({
      status: 'paused-limit',
      retryAfterMs: 60_000,
      indexed: { indexed: 1, total: 3 },
    })
    expect(pipeline.requestSection).not.toHaveBeenCalled()
  })

  test('blocking concept-pass errors, or a paused pass, request no sections', async () => {
    const results: ConceptPassProgress[] = [
      ...(['signin-required', 'auth', 'aborted'] as const).map((code) => ({
        indexed: 1,
        total: 3,
        done: false,
        error: new LlmError(code, 'blocked'),
      })),
      { indexed: 2, total: 3, done: false },
    ]
    for (const p of results) {
      const pipeline = fakePipeline()
      const result = await createBookRun({
        pipeline,
        concepts: fakeConcepts(p),
        sections: BOOK,
      }).start()
      expect(result.status).toBe('paused')
      expect(result.retryAfterMs).toBeUndefined()
      expect(result.stoppedBy).toEqual(
        p.error ? { code: p.error.code, message: 'blocked' } : undefined,
      )
      expect(pipeline.requestSection).not.toHaveBeenCalled()
    }
  })

  test.each(['schema', 'timeout', 'upstream'] as const)(
    'an incomplete concept-pass %s error proceeds only for schema failures',
    async (code) => {
      const pipeline = fakePipeline()
      const result = createBookRun({
        pipeline,
        concepts: fakeConcepts({
          indexed: 2,
          total: 3,
          done: false,
          error: new LlmError(code, 'context gap'),
        }),
        sections: BOOK,
        concurrency: 4,
      }).start()
      await flush()
      if (code !== 'schema') {
        expect(await result).toMatchObject({
          status: 'paused',
          stoppedBy: { code, message: 'context gap' },
        })
        expect(pipeline.requestSection).not.toHaveBeenCalled()
        return
      }
      expect(pipeline.requestSection).toHaveBeenCalledTimes(4)
      for (const h of pipeline.open()) h.done()
      expect(await result).toMatchObject({ status: 'done', finished: 4 })
    },
  )

  test('glossary and summary gaps do not block any section on start or Resume', async () => {
    const pipeline = fakePipeline()
    const run = createBookRun({
      pipeline,
      concepts: fakeConcepts({
        indexed: 2,
        total: 3,
        done: true,
        failed: 1,
        gaps: ['glossary', 'book-summary'],
      }),
      sections: BOOK,
      concurrency: 4,
    })
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = run.start()
      await flush()
      for (const h of pipeline.open()) h.done()
      expect(await result).toMatchObject({ status: 'done', finished: 4 })
    }
    expect(pipeline.requestSection).toHaveBeenCalledTimes(8)
  })

  test('a real pass with indexer and context gaps illustrates every section; automatic indexNow and Resume skip gaps', async () => {
    const repos = createMemoryRepos()
    const book = make.bookMeta()
    const sections = ['a', 'b', 'c'].map((id, i) =>
      section(id, i, {
        bookId: book.bookId,
        blockIds: [`${id}:b0`],
      }),
    )
    await repos.books.put(book)
    await repos.sections.bulkPut(sections)
    await repos.blocks.bulkPut(
      sections.map((s) =>
        make.block({
          blockId: s.blockIds[0]!,
          sectionId: s.sectionId,
        }),
      ),
    )
    const calls: string[] = []
    const llm: LlmCall = {
      async call(role) {
        calls.push(role)
        if (role !== 'indexer') throw new LlmError('schema', `${role} failed`)
        return {
          // A partial indexer response leaves c as a remembered index gap.
          data: {
            sections: sections.slice(0, 2).map((s) =>
              make.sectionIndexOutput({
                sectionId: s.sectionId,
                defines: [],
                uses: [{ name: 'log' }, { name: 'replicated log' }],
              }),
            ),
          } as never,
          model: 'replay',
          effort: 'medium',
          promptVersion: '1',
          usage: { input: 1, output: 1, cachedInput: 0 },
          latencyMs: 1,
          requestId: 'r',
        }
      },
    }
    const pipeline = fakePipeline()
    const request = pipeline.requestSection.getMockImplementation()!
    const indexing: Promise<boolean>[] = []
    for (let attempt = 0; attempt < 2; attempt++) {
      const concepts = createConceptPass({ bookId: book.bookId, repos, llm })
      pipeline.requestSection.mockImplementation((id, opts) => {
        // Match the real pipeline's automatic missing-section lookup.
        indexing.push(concepts.indexNow(id))
        return request(id, opts)
      })
      const result = createBookRun({
        pipeline,
        concepts,
        sections,
        concurrency: 3,
      }).start()
      await vi.waitFor(() => expect(pipeline.open()).toHaveLength(3))
      for (const h of pipeline.open()) h.done()
      expect(await result).toMatchObject({ status: 'done', finished: 3 })
      expect(await concepts.progress()).toMatchObject({
        done: true,
        failed: 1,
        gaps: ['glossary', 'book-summary'],
      })
    }
    expect(await Promise.all(indexing)).toEqual([
      true,
      true,
      false,
      true,
      true,
      false,
    ])
    expect(calls).toEqual(['indexer', 'book-summary', 'glossary'])
    expect((await repos.books.get(book.bookId))?.summary).toBeUndefined()
    expect(pipeline.requestSection.mock.calls.map(([id]) => id)).toEqual([
      'a',
      'b',
      'c',
      'a',
      'b',
      'c',
    ])
  })

  test('a pass that completed without its failed batches still illustrates every section', async () => {
    const pipeline = fakePipeline()
    const result = createBookRun({
      pipeline,
      concepts: fakeConcepts({ indexed: 2, total: 3, done: true, failed: 1 }),
      sections: BOOK,
      concurrency: 4,
    }).start()
    await flush()
    for (const h of pipeline.open()) h.done()
    expect(await result).toMatchObject({ status: 'done', finished: 4 })
  })

  test('requests in reading order, never more than `concurrency` at once, all as background requests', async () => {
    const pipeline = fakePipeline()
    const run = createBookRun({
      pipeline,
      concepts: fakeConcepts(),
      sections: BOOK,
      concurrency: 2,
    })
    const result = run.start()
    let maxOpen = 0
    for (let i = 0; i < 6; i++) {
      await flush()
      const open = pipeline.open()
      maxOpen = Math.max(maxOpen, open.length)
      expect(run.progress.inProgress).toEqual(open.map((h) => h.sectionId))
      open[0]?.done()
    }
    await flush()
    expect(maxOpen).toBe(2)
    expect(pipeline.requestSection.mock.calls.map((c) => c[0])).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
    for (const [, opts] of pipeline.requestSection.mock.calls)
      expect(opts).toEqual({ background: true, keepOthers: true })
    expect(await result).toMatchObject({
      status: 'done',
      total: 4,
      finished: 4,
      inProgress: [],
    })
  })

  test('a full pass counts no-visual sections and failed items', async () => {
    const pipeline = fakePipeline()
    const seen: BookRunProgress[] = []
    const run = createBookRun({
      pipeline,
      concepts: fakeConcepts(),
      sections: BOOK,
      concurrency: 1,
      onProgress: (p) => seen.push(p),
    })
    const result = run.start()
    const drive = async (fn: (h: FakeHandle) => void) => {
      await flush()
      const h = pipeline.open()[0]!
      fn(h)
      h.done()
    }
    await drive((h) => h.emit('no-visual', { reason: 'nothing to draw' }))
    await drive((h) =>
      h.emit('item-failed', {
        planItemId: 'p1',
        code: 'schema',
        message: 'bad',
      }),
    )
    await drive((h) =>
      h.emit('error', { code: 'planner', message: 'planner failed' }),
    )
    await drive(() => {})
    const final = await result
    expect(final).toEqual({
      status: 'done',
      total: 4,
      finished: 4,
      noVisual: 1,
      failedItems: 2,
      inProgress: [],
      indexed: { indexed: 3, total: 3 },
      sections: { a: 'no-visual', b: 'failed', c: 'failed', d: 'cached' },
      startedAt: expect.any(Number),
      sessionDone: 2,
      avgSectionMs: expect.any(Number),
    })
    expect(run.progress).toEqual(final)
    const finished = seen.map((p) => p.finished)
    expect(finished).toEqual([...finished].sort((x, y) => x - y))
    expect(seen.filter((p) => p.status === 'understanding')).toHaveLength(1)
    expect(seen.at(-1)).toEqual(final)
  })

  test('a plan-limit item failure cancels the open handles, starts no new section and pauses with the reset time', async () => {
    const pipeline = fakePipeline()
    const run = createBookRun({
      pipeline,
      concepts: fakeConcepts(),
      sections: BOOK,
    })
    const result = run.start()
    await flush()
    const [a, b] = pipeline.handles
    a!.emit('item-failed', {
      planItemId: 'p1',
      code: 'plan-limit',
      message: 'limit',
      retryAfterMs: 90_000,
    })
    expect(a!.cancelled).toBe(true)
    expect(b!.cancelled).toBe(true)
    const final = await result
    expect(final).toMatchObject({
      status: 'paused-limit',
      retryAfterMs: 90_000,
      finished: 0,
      failedItems: 0,
      inProgress: [],
    })
    expect(pipeline.requestSection).toHaveBeenCalledTimes(2)
  })

  test("a job's plan-limit error pauses the run too", async () => {
    const pipeline = fakePipeline()
    const result = createBookRun({
      pipeline,
      concepts: fakeConcepts(),
      sections: BOOK,
      concurrency: 1,
    }).start()
    await flush()
    pipeline.handles[0]!.done()
    await flush()
    pipeline.handles[1]!.emit('error', { code: 'plan-limit', message: 'limit' })
    expect(pipeline.handles[1]!.cancelled).toBe(true)
    const final = await result
    expect(final).toMatchObject({ status: 'paused-limit', finished: 1 })
    expect(final.retryAfterMs).toBeUndefined()
    expect(pipeline.requestSection).toHaveBeenCalledTimes(2)
  })

  test.each(['signin-required', 'auth'])(
    'a %s failure cancels the open handles, starts no new section and pauses with the reason',
    async (code) => {
      const pipeline = fakePipeline()
      const result = createBookRun({
        pipeline,
        concepts: fakeConcepts(),
        sections: BOOK,
      }).start()
      await flush()
      const [a, b] = pipeline.handles
      a!.emit('item-failed', { planItemId: 'p1', code, message: 'Sign in' })
      expect(a!.cancelled).toBe(true)
      expect(b!.cancelled).toBe(true)
      expect(await result).toMatchObject({
        status: 'paused',
        stoppedBy: { code, message: 'Sign in' },
        failedItems: 0,
        finished: 0,
      })
      expect(pipeline.requestSection).toHaveBeenCalledTimes(2)
    },
  )

  /** Ends the next open section: a planner `error` with `code`, or a drawn item when `code` is null. */
  const endNext = async (
    pipeline: ReturnType<typeof fakePipeline>,
    code: string | null,
  ) => {
    await flush()
    const h = pipeline.open()[0]!
    if (code) h.emit('error', { code, message: `${code} failed` })
    else
      h.emit('item-ready', {
        planItemId: 'p1',
        record: make.visualRecord(),
        fromCache: false,
      })
    h.done()
  }

  test(`${MAX_FAILED_IN_A_ROW} sections in a row failing on upstream or timeout errors pause the run`, async () => {
    expect(MAX_FAILED_IN_A_ROW).toBe(3)
    const pipeline = fakePipeline()
    const result = createBookRun({
      pipeline,
      concepts: fakeConcepts(),
      sections: BOOK,
      concurrency: 1,
    }).start()
    await endNext(pipeline, 'upstream')
    await endNext(pipeline, 'timeout')
    await endNext(pipeline, 'upstream')
    expect(await result).toMatchObject({
      status: 'paused',
      stoppedBy: { code: 'upstream', message: 'upstream failed' },
      finished: 3,
      failedItems: 3,
    })
    expect(pipeline.requestSection).toHaveBeenCalledTimes(3)
  })

  test('a section that draws resets the count, and content failures never pause the run', async () => {
    const pipeline = fakePipeline()
    const result = createBookRun({
      pipeline,
      concepts: fakeConcepts(),
      sections: BOOK,
      concurrency: 1,
    }).start()
    await endNext(pipeline, 'upstream')
    await endNext(pipeline, 'upstream')
    await endNext(pipeline, null)
    await endNext(pipeline, 'schema')
    const final = await result
    expect(final).toMatchObject({ status: 'done', finished: 4, failedItems: 3 })
    expect(final.stoppedBy).toBeUndefined()
  })

  test('pause() cancels the open handles and resolves start() with paused', async () => {
    const pipeline = fakePipeline()
    const run = createBookRun({
      pipeline,
      concepts: fakeConcepts(),
      sections: BOOK,
    })
    const result = run.start()
    await flush()
    pipeline.handles[0]!.done()
    await flush()
    expect(pipeline.handles).toHaveLength(3)
    run.pause()
    expect(pipeline.handles.slice(1).every((h) => h.cancelled)).toBe(true)
    expect(await result).toMatchObject({
      status: 'paused',
      finished: 1,
      inProgress: [],
    })
    expect(pipeline.requestSection).toHaveBeenCalledTimes(3)
  })

  test('pause() during the concept pass pauses it and requests nothing', async () => {
    const pipeline = fakePipeline()
    let finishPass!: (p: ConceptPassProgress) => void
    const concepts = {
      start: vi.fn(
        () => new Promise<ConceptPassProgress>((r) => (finishPass = r)),
      ),
      pause: vi.fn(() => finishPass({ indexed: 1, total: 3, done: false })),
    }
    const run = createBookRun({ pipeline, concepts, sections: BOOK })
    const result = run.start()
    await flush()
    run.pause()
    expect(concepts.pause).toHaveBeenCalledOnce()
    expect(await result).toMatchObject({ status: 'paused' })
    expect(pipeline.requestSection).not.toHaveBeenCalled()
  })

  test('start() is idempotent while running, and a later start() walks every section again', async () => {
    const pipeline = fakePipeline()
    const concepts = fakeConcepts()
    const run = createBookRun({
      pipeline,
      concepts,
      sections: BOOK,
      concurrency: 4,
    })
    const first = run.start()
    expect(run.start()).toBe(first)
    await flush()
    expect(concepts.start).toHaveBeenCalledOnce()
    run.pause()
    expect((await first).status).toBe('paused')
    const second = run.start()
    expect(second).not.toBe(first)
    await flush()
    for (const h of pipeline.open()) h.done()
    expect(await second).toMatchObject({ status: 'done', finished: 4 })
    expect(
      pipeline.requestSection.mock.calls.slice(4).map((c) => c[0]),
    ).toEqual(['a', 'b', 'c', 'd'])
  })

  test('starts at the section being read, then wraps around to the earlier ones', async () => {
    for (const [startAt, expected] of [
      ['c', ['c', 'd', 'a', 'b']],
      ['merged', ['b', 'c', 'd', 'a']],
      ['empty', ['a', 'b', 'c', 'd']],
      ['unknown', ['a', 'b', 'c', 'd']],
    ] as const) {
      const pipeline = fakePipeline()
      const result = createBookRun({
        pipeline,
        concepts: fakeConcepts(),
        sections: BOOK,
        startAt,
        concurrency: 4,
      }).start()
      await flush()
      for (const h of pipeline.open()) h.done()
      expect(await result).toMatchObject({ status: 'done', finished: 4 })
      expect(pipeline.requestSection.mock.calls.map((c) => c[0])).toEqual(
        expected,
      )
    }
  })

  test('a resume right after pause() starts a new run once the paused one settles', async () => {
    const pipeline = fakePipeline()
    const run = createBookRun({
      pipeline,
      concepts: fakeConcepts(),
      sections: BOOK,
      concurrency: 4,
    })
    const first = run.start()
    await flush()
    run.pause()
    const resumed = run.start()
    expect((await first).status).toBe('paused')
    await flush()
    expect(pipeline.requestSection).toHaveBeenCalledTimes(8)
    for (const h of pipeline.open()) h.done()
    expect(await resumed).toMatchObject({ status: 'done', finished: 4 })
  })

  test('a throwing request rejects start() only after every other section settles', async () => {
    const pipeline = fakePipeline()
    const real = pipeline.requestSection.getMockImplementation()!
    pipeline.requestSection.mockImplementation((id, opts) => {
      if (id === 'b') throw new Error('boom')
      return real(id, opts)
    })
    const run = createBookRun({
      pipeline,
      concepts: fakeConcepts(),
      sections: BOOK,
    })
    await expect(run.start()).rejects.toThrow('boom')
    expect(
      pipeline.handles.map((h) => [h.sectionId, h.cancelled, h.ended]),
    ).toEqual([['a', true, true]])
    expect(run.progress).toMatchObject({ status: 'paused', inProgress: [] })
  })

  test('progress is a snapshot', async () => {
    const run = createBookRun({
      pipeline: fakePipeline(),
      concepts: fakeConcepts(),
      sections: BOOK,
    })
    expect(run.progress).toMatchObject({
      status: 'paused',
      total: 4,
      finished: 0,
      inProgress: [],
    })
    const p = run.progress
    p.inProgress.push('x')
    expect(run.progress.inProgress).toEqual([])
  })
})

describe('resumable runs (ADR 0064)', () => {
  /** A fake `sectionCacheStatus` over a mutable state map; unknown ids are `missing`. */
  const cacheOf = (states: Record<string, SectionCacheState>) =>
    vi.fn(async (ids: readonly string[]) => {
      return new Map<string, SectionCacheStatus>(
        ids.map((id) => [id, { state: states[id] ?? 'missing', visuals: [] }]),
      )
    })

  test('cached and no-visual sections count from the first report and are never requested', async () => {
    const states: Record<string, SectionCacheState> = {
      a: 'cached',
      b: 'partial',
      c: 'no-visual',
    }
    const pipeline = { ...fakePipeline(), sectionCacheStatus: cacheOf(states) }
    const seen: BookRunProgress[] = []
    const run = createBookRun({
      pipeline,
      concepts: fakeConcepts(),
      sections: BOOK,
      concurrency: 4,
      onProgress: (p) => seen.push(p),
    })
    const result = run.start()
    await flush()
    expect(pipeline.sectionCacheStatus).toHaveBeenCalledWith([
      'a',
      'b',
      'c',
      'd',
    ])
    expect(seen[0]).toMatchObject({
      status: 'understanding',
      finished: 2,
      noVisual: 1,
      sections: { a: 'cached', b: 'pending', c: 'no-visual', d: 'pending' },
    })
    expect(seen.every((p) => p.finished >= 2)).toBe(true)
    expect(pipeline.requestSection.mock.calls.map((c) => c[0])).toEqual([
      'b',
      'd',
    ])
    for (const h of pipeline.open()) h.done()
    expect(await result).toMatchObject({ status: 'done', finished: 4 })

    // A later start() never drops the count: it starts from what is cached now.
    states.b = 'cached'
    states.d = 'cached'
    seen.length = 0
    const again = await run.start()
    expect(seen[0]!.finished).toBe(4)
    expect(again).toMatchObject({ status: 'done', finished: 4 })
    expect(pipeline.requestSection).toHaveBeenCalledTimes(2)
  })

  test('a failing cache check falls back to requesting every section', async () => {
    const pipeline = {
      ...fakePipeline(),
      sectionCacheStatus: vi.fn(async () => {
        throw new Error('db closed')
      }),
    }
    const result = createBookRun({
      pipeline,
      concepts: fakeConcepts(),
      sections: BOOK,
      concurrency: 4,
    }).start()
    await flush()
    expect(pipeline.requestSection).toHaveBeenCalledTimes(4)
    for (const h of pipeline.open()) h.done()
    expect(await result).toMatchObject({ status: 'done', finished: 4 })
  })

  test('the per-section map and the cursor follow the run in its order', async () => {
    const pipeline = fakePipeline()
    const run = createBookRun({
      pipeline,
      concepts: fakeConcepts(),
      sections: BOOK,
      startAt: 'c',
      concurrency: 1,
    })
    const result = run.start()
    const next = async () => {
      await flush()
      return pipeline.open()[0]!
    }
    let h = await next()
    expect(run.progress.sections).toEqual({
      a: 'pending',
      b: 'pending',
      c: 'running',
      d: 'pending',
    })
    expect(run.progress.cursor).toBe('c')
    h.emit('item-ready', {
      planItemId: 'p1',
      record: make.visualRecord(),
      fromCache: false,
    })
    h.done()
    h = await next()
    expect(run.progress.sections.c).toBe('done')
    expect(run.progress.cursor).toBe('d')
    h.emit('item-failed', { planItemId: 'p1', code: 'schema', message: 'x' })
    h.done()
    h = await next()
    h.emit('no-visual', { reason: 'nothing' })
    h.done()
    h = await next()
    h.emit('plan', {
      plan: make.visualPlan(),
      record: make.planRecord(),
      partialContext: false,
      fromCache: true,
    })
    h.emit('item-ready', {
      planItemId: 'p1',
      record: make.visualRecord(),
      fromCache: true,
    })
    h.done()
    const final = await result
    expect(final.sections).toEqual({
      c: 'done',
      d: 'failed',
      a: 'no-visual',
      b: 'cached',
    })
    expect(final.cursor).toBeUndefined()
  })

  test('pause puts the open sections back to pending and the cursor on the first unfinished one', async () => {
    const pipeline = fakePipeline()
    const run = createBookRun({
      pipeline,
      concepts: fakeConcepts(),
      sections: BOOK,
      startAt: 'b',
      concurrency: 2,
    })
    const result = run.start()
    await flush()
    pipeline.open()[1]!.done() // c finishes first; b is still open.
    await flush()
    expect(run.progress.cursor).toBe('b')
    run.pause()
    const final = await result
    expect(final.sections).toEqual({
      a: 'pending',
      b: 'pending',
      c: 'cached',
      d: 'pending',
    })
    expect(final.cursor).toBe('b')
    expect(final.finished).toBe(1)
  })

  test('timing counts only sections that did work in this session', async () => {
    let now = 1_000
    const pipeline = {
      ...fakePipeline(),
      sectionCacheStatus: cacheOf({ a: 'cached' }),
    }
    const run = createBookRun({
      pipeline,
      concepts: fakeConcepts(),
      sections: BOOK,
      concurrency: 1,
      now: () => now,
    })
    const result = run.start()
    const work = async (ms: number, fromCache: boolean) => {
      await flush()
      const h = pipeline.open()[0]!
      now += ms
      h.emit('item-ready', {
        planItemId: 'p1',
        record: make.visualRecord(),
        fromCache,
      })
      h.done()
    }
    await work(4_000, false) // b
    await work(10, true) // c: served from the cache by the job
    await work(8_000, false) // d
    const final = await result
    expect(final).toMatchObject({
      startedAt: 1_000,
      sessionDone: 2,
      avgSectionMs: 6_000,
      finished: 4,
    })
  })
})
