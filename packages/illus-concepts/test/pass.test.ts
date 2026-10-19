import { LlmError, makeBlockId, makeSectionId } from '@illus/core'
import type {
  Block,
  IndexerOutput,
  LlmCall,
  LlmContext,
  LlmCallOptions,
  RoleName,
  SectionNode,
} from '@illus/core'
import { createMemoryRepos, make } from '@illus/core/testing'
import { describe, expect, expectTypeOf, test } from 'vitest'

import {
  GLOSSARY_EVERY,
  MAX_TRANSIENT_BATCHES_IN_A_ROW,
  SUMMARY_AT,
  conceptPassStateKey,
  createConceptPass,
  resetConceptPassState,
} from '../src/index.ts'
import type { ConceptPassGap, ConceptPassProgress } from '../src/index.ts'

const BOOK = '0123456789abcdef'
const N = 10

interface Call {
  role: RoleName
  ctx: LlmContext
  opts: LlmCallOptions<unknown>
}

function fakeLlm(answer: (c: Call) => unknown): LlmCall & { calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    async call(role, ctx, opts = {}) {
      const c = { role, ctx, opts: opts as LlmCallOptions<unknown> }
      calls.push(c)
      if (opts.signal?.aborted) throw new LlmError('aborted', 'aborted')
      const data = await answer(c)
      return {
        data: data as never,
        model: 'gpt-6-luna',
        effort: 'medium',
        promptVersion: '1.0.0',
        usage: { input: 1, output: 1, cachedInput: 0 },
        latencyMs: 1,
        requestId: 'r',
      }
    },
  }
}

/** N one-block sections; section k defines "term k", the first uses "leader". */
async function book(tokenEstimate = 2000) {
  const repos = createMemoryRepos()
  const sections: SectionNode[] = []
  const blocks: Block[] = []
  for (let k = 0; k < N; k++) {
    const sectionId = makeSectionId({
      bookId: BOOK,
      spineIndex: k,
      headingPath: [`S${k}`],
      ordinalInSpine: 0,
    })
    const blockId = makeBlockId(sectionId, 0)
    blocks.push({
      blockId,
      sectionId,
      kind: 'paragraph',
      text: `Here term ${k} is defined as a thing the leader uses.`,
      cfiRange: 'epubcfi(/6/2!/4/2)',
    })
    sections.push(
      make.sectionNode({
        sectionId,
        ordinal: k,
        level: 1,
        title: `S${k}`,
        headingPath: [`S${k}`],
        parentId: undefined,
        blockIds: [blockId],
        tokenEstimate,
      }),
    )
  }
  await repos.books.put(make.bookMeta({ sectionCount: N }))
  await repos.sections.bulkPut(sections)
  await repos.blocks.bulkPut(blocks)
  return { repos, sections }
}

/** Indexer answers from the batch body; definitions of odd sections carry a quote that does not ground. */
function answer(c: Call): unknown {
  if (c.role === 'indexer') {
    const ids = [...c.ctx.body.matchAll(/<section id="([^"]+)"/g)].map(
      (m) => m[1]!,
    )
    const out: IndexerOutput = {
      sections: ids.map((sectionId) => {
        const k = Number(/:(\d+):s/.exec(sectionId)![1])
        return {
          sectionId,
          summary: `Section ${k}.`,
          defines: [
            {
              name: `term ${k}`,
              evidence: {
                blockId: makeBlockId(sectionId, 0),
                quote:
                  k % 2 ? 'words that are not there' : `term ${k} is defined`,
              },
            },
          ],
          uses: [
            { name: k === 0 ? 'leader' : 'leaders' },
            { name: k === 3 ? 'log' : 'replicated log' },
          ],
          flags: make.sectionIndexOutput().flags,
        }
      }),
    }
    return out
  }
  if (c.role === 'glossary')
    return { merges: [{ canonical: 'replicated log', aliases: ['log'] }] }
  return {
    summary: `Summary from ${
      c.ctx.body.split('<summary ').length - 1
    } sections.`,
    conventions: ['Terms are numbered.'],
  }
}

describe('concept pass', () => {
  test('book context arrives early: summary at 10% indexed, glossary merge every 15 sections', () => {
    expect([SUMMARY_AT, GLOSSARY_EVERY]).toEqual([0.1, 15])
  })

  test('keeps complete block arrays per section, including empty and multi-block sections', async () => {
    const { repos, sections } = await book()
    const empty = sections[0]!
    await repos.blocks.delete(empty.blockIds[0]!)
    await repos.sections.put({ ...empty, blockIds: [], tokenEstimate: 0 })
    const multi = sections[1]!
    const extra = {
      ...(await repos.blocks.get(multi.blockIds[0]!))!,
      blockId: makeBlockId(multi.sectionId, 1),
      text: 'A second paragraph belongs to this same section.',
    }
    await repos.blocks.put(extra)
    await repos.sections.put({
      ...multi,
      blockIds: [...multi.blockIds, extra.blockId],
    })
    const llm = fakeLlm(answer)
    expect(
      await createConceptPass({ bookId: BOOK, repos, llm }).start(),
    ).toMatchObject({ indexed: N, done: true })
    expect(await repos.sectionIndex.get(empty.sectionId)).toMatchObject({
      summary: empty.title,
      indexedWith: { model: 'none' },
    })
    const batches = llm.calls.filter((call) => call.role === 'indexer')
    expect(
      batches.every(
        (call) => !call.ctx.body.includes(`<section id="${empty.sectionId}"`),
      ),
    ).toBe(true)
    const request = batches.find((call) =>
      call.ctx.body.includes(`<section id="${multi.sectionId}"`),
    )!
    expect(request.ctx.body).toContain(`id="${multi.blockIds[0]}"`)
    expect(request.ctx.body).toContain(`id="${extra.blockId}"`)
    expect(request.ctx.body).toContain(extra.text)
  })

  test('indexes in batches, grounds definitions, merges the glossary, summarises at SUMMARY_AT (10%) and at completion', async () => {
    const { repos, sections } = await book()
    const llm = fakeLlm(answer)
    const progress: number[] = []
    const pass = createConceptPass({
      bookId: BOOK,
      repos,
      llm,
      now: () => 5,
      onProgress: (p) => progress.push(p.indexed),
    })
    const done = await pass.start()
    expect(done).toEqual({ indexed: N, total: N, done: true })
    // 2,000-token sections → 4 per 8,000-token batch.
    expect(
      llm.calls
        .filter((c) => c.role === 'indexer')
        .map((c) => c.ctx.body.split('<section ').length - 1),
    ).toEqual([4, 4, 2])
    // Every completed model call reports, including the glossary and both summaries; then done.
    expect(progress).toEqual([4, 4, 8, 10, 10, 10, 10])
    expect(llm.calls.map((c) => c.role)).toEqual([
      'indexer',
      'book-summary',
      'indexer',
      'indexer',
      'glossary',
      'book-summary',
    ])
    // The first summary saw 4 sections; the second all 10. Later indexer calls carry the summary in the prefix.
    expect(llm.calls[1]!.ctx.body.split('<summary ').length - 1).toBe(4)
    expect(llm.calls[2]!.ctx.prefix).toContain(
      '<summary>Summary from 4 sections.</summary>',
    )
    expect((await repos.books.get(BOOK))!.summary!.summary).toBe(
      'Summary from 10 sections.',
    )
    expect(llm.calls[4]!.ctx.body).toContain(
      '<cluster><name>log</name></cluster>',
    )

    const r0 = await repos.sectionIndex.get(sections[0]!.sectionId)
    expect(r0!.defines[0]!.evidence).toMatchObject({ start: 5, end: 22 })
    expect(r0!.indexedWith).toEqual({
      model: 'gpt-6-luna',
      promptVersion: '1.0.0',
    })
    expect(
      (await repos.sectionIndex.get(sections[1]!.sectionId))!.defines,
    ).toEqual([])

    const concepts = await repos.concepts.listByBook(BOOK)
    const leader = concepts.find(
      (c) => c.canonical === 'leaders' || c.canonical === 'leader',
    )!
    expect(leader).toMatchObject({
      firstOrdinal: 0,
      spanning: true,
      aliases: [expect.any(String)],
    })
    expect(
      concepts.find((c) => c.canonical === 'replicated log'),
    ).toMatchObject({
      aliases: ['log'],
      usedInSectionIds: sections.map((s) => s.sectionId),
    })
    expect(concepts.find((c) => c.canonical === 'term 0')).toMatchObject({
      definedInSectionId: sections[0]!.sectionId,
      spanning: false,
    })

    // Resumable: a finished book makes no calls.
    const again = createConceptPass({ bookId: BOOK, repos, llm })
    await again.start()
    expect(llm.calls).toHaveLength(6)
  })

  test('indexNow jumps the queue; the open section comes next', async () => {
    const { repos, sections } = await book(5000)
    const llm = fakeLlm(answer)
    const pass = createConceptPass({ bookId: BOOK, repos, llm })
    pass.setOpenSection(sections[6]!.sectionId)
    const ok = await pass.indexNow(sections[8]!.sectionId)
    expect(ok).toBe(true)
    await pass.start()
    const order = llm.calls
      .filter((c) => c.role === 'indexer')
      .map((c) => /:(\d+):s/.exec(c.ctx.body)![1])
    expect(order.slice(0, 2)).toEqual(['8', '6'])
  })

  test('a plan limit stops the pass with the error; start() resumes where it stopped', async () => {
    const { repos } = await book()
    let limit = true
    const llm = fakeLlm((c) => {
      if (
        c.role === 'indexer' &&
        limit &&
        llm.calls.filter((x) => x.role === 'indexer').length === 2
      )
        throw new LlmError('plan-limit', 'limit')
      return answer(c)
    })
    const pass = createConceptPass({ bookId: BOOK, repos, llm })
    const stopped = await pass.start()
    expect(stopped.error?.code).toBe('plan-limit')
    expect(stopped.indexed).toBe(4)
    limit = false
    expect(await pass.start()).toMatchObject({ indexed: N, done: true })
  })

  test('a schema failure retries the batch once on the escalation tier', async () => {
    const { repos } = await book()
    const llm = fakeLlm((c) => {
      if (c.role === 'indexer' && !c.opts.escalate && llm.calls.length === 1)
        throw new LlmError('schema', 'bad')
      return answer(c)
    })
    await createConceptPass({ bookId: BOOK, repos, llm }).start()
    expect(
      llm.calls.slice(0, 2).map((c) => [c.role, c.opts.escalate ?? false]),
    ).toEqual([
      ['indexer', false],
      ['indexer', true],
    ])
  })

  test('failed batches persist across Resume and recreation; explicit retry fills them (ADR 0061)', async () => {
    const { repos } = await book()
    let broken = true
    const llm = fakeLlm((c) => {
      // The batch holding S0 fails on both tiers while `broken`.
      if (
        c.role === 'indexer' &&
        broken &&
        [...c.ctx.body.matchAll(/<section id="([^"]+)"/g)].some((m) =>
          /:0:s/.test(m[1]!),
        )
      )
        throw new LlmError('schema', 'bad batch')
      return answer(c)
    })
    const pass = createConceptPass({ bookId: BOOK, repos, llm })
    const first = await pass.start()
    // Batches here hold 4 sections (8,000 tokens of 2,000-token sections).
    expect(first).toMatchObject({ done: true, failed: 4, indexed: N - 4 })
    expect(first.error).toBeUndefined()
    // The book context is finished without the failed batch.
    expect(llm.calls.at(-1)?.role).toBe('book-summary')
    expect((await repos.books.get(BOOK))?.indexStatus).toBe('complete')

    broken = false
    llm.calls.length = 0
    const resumed = createConceptPass({ bookId: BOOK, repos, llm })
    expect(await resumed.progress()).toMatchObject({ failed: 4 })
    expect(await resumed.start()).toMatchObject({ done: true, failed: 4 })
    expect(await pass.start()).toMatchObject({ done: true, failed: 4 })
    expect(llm.calls).toHaveLength(0)
    const second = await resumed.retryGaps()
    expect(second).toMatchObject({ done: true, indexed: N })
    expect(second.failed).toBeUndefined()
    expect(llm.calls.filter((c) => c.role === 'indexer')).toHaveLength(1)
    // Filling the gap refreshes context from the full book.
    expect((await repos.books.get(BOOK))?.summary?.summary).toBe(
      'Summary from 10 sections.',
    )
  })

  test.each(['glossary', 'book-summary'] as const)(
    '%s schema/timeout/upstream failures leave a usable book and a persisted, explicitly retryable gap',
    async (role) => {
      for (const code of ['schema', 'timeout', 'upstream'] as const) {
        const { repos } = await book()
        const llm = fakeLlm((c) => {
          if (c.role === role) throw new LlmError(code, 'bad optional context')
          return answer(c)
        })
        const seen: number[] = []
        const pass = createConceptPass({
          bookId: BOOK,
          repos,
          llm,
          glossaryEvery: 4,
          onProgress: () => seen.push(llm.calls.length),
        })
        expect(await pass.start()).toMatchObject({
          indexed: N,
          done: true,
          gaps: [role],
        })
        expect((await repos.books.get(BOOK))?.indexStatus).toBe('complete')
        expect(await repos.settings.get(`conceptPass:${BOOK}`)).toMatchObject({
          version: 1,
          gaps: { [role]: { code, message: 'bad optional context' } },
        })
        expect(llm.calls.filter((c) => c.role === role)).toHaveLength(1)
        // Reports cover successful and failed calls, even when the index count is unchanged.
        for (let count = 1; count <= llm.calls.length; count++)
          expect(seen).toContain(count)
        if (role === 'book-summary')
          expect((await repos.books.get(BOOK))?.summary).toBeUndefined()
        else expect(await repos.concepts.listByBook(BOOK)).toEqual([])

        const healed = fakeLlm(answer)
        const later = createConceptPass({ bookId: BOOK, repos, llm: healed })
        expect(await later.progress()).toMatchObject({
          done: true,
          gaps: [role],
        })
        await later.start()
        expect(healed.calls).toHaveLength(0)
        expect((await later.retryGaps()).gaps).toBeUndefined()
        expect(healed.calls.some((c) => c.role === role)).toBe(true)
        expect((await repos.books.get(BOOK))?.summary).toBeDefined()
        expect((await repos.concepts.listByBook(BOOK)).length).toBeGreaterThan(
          0,
        )
      }
    },
  )

  test('a remembered failed batch is skipped after a usage limit interrupts the pass', async () => {
    const { repos } = await book()
    let limit = true
    const llm = fakeLlm((c) => {
      if (c.role === 'indexer' && /:0:s/.test(c.ctx.body))
        throw new LlmError('schema', 'bad batch')
      if (c.role === 'indexer' && limit)
        throw new LlmError('plan-limit', 'limit')
      return answer(c)
    })
    expect(
      await createConceptPass({ bookId: BOOK, repos, llm }).start(),
    ).toMatchObject({
      done: false,
      failed: 4,
      error: { code: 'plan-limit' },
    })
    llm.calls.length = 0
    limit = false
    const resumed = createConceptPass({ bookId: BOOK, repos, llm })
    expect(await resumed.start()).toMatchObject({
      done: true,
      failed: 4,
      indexed: N - 4,
    })
    expect(
      llm.calls
        .filter((c) => c.role === 'indexer')
        .some((c) => /:0:s/.test(c.ctx.body)),
    ).toBe(false)
  })

  test.each(['upstream', 'timeout'] as const)(
    'three consecutive %s batches pause without persisting failures; start retries when healthy',
    async (code) => {
      const { repos } = await book(5000)
      let offline = true
      const llm = fakeLlm((c) => {
        if (offline) throw new LlmError(code, 'network unavailable')
        return answer(c)
      })
      const seen: number[] = []
      const pass = createConceptPass({
        bookId: BOOK,
        repos,
        llm,
        onProgress: () => seen.push(llm.calls.length),
      })
      expect(MAX_TRANSIENT_BATCHES_IN_A_ROW).toBe(3)
      expect(await pass.start()).toMatchObject({ done: false, error: { code } })
      expect(llm.calls.map((c) => c.role)).toEqual(Array(6).fill('indexer'))
      expect(await repos.settings.get(conceptPassStateKey(BOOK))).toMatchObject(
        {
          failedSectionIds: [],
          gaps: {},
        },
      )
      for (let count = 1; count <= 6; count++) expect(seen).toContain(count)
      offline = false
      expect(await pass.start()).toEqual({ indexed: N, total: N, done: true })
    },
  )

  test('a successful batch resets the transient streak and skipped sections can be retried on start', async () => {
    const { repos } = await book(5000)
    let outage = true
    const llm = fakeLlm((c) => {
      if (c.role === 'indexer' && outage && /:(0|1|3|4):s/.test(c.ctx.body))
        throw new LlmError('upstream', 'network unavailable')
      return answer(c)
    })
    const pass = createConceptPass({ bookId: BOOK, repos, llm })
    expect(await pass.start()).toMatchObject({ done: true, indexed: N - 4 })
    expect(await repos.settings.get(conceptPassStateKey(BOOK))).toMatchObject({
      failedSectionIds: [],
    })
    outage = false
    expect(await pass.start()).toEqual({ indexed: N, total: N, done: true })
  })

  test('resetConceptPassState allows re-indexing with the same book ID and index version', async () => {
    const { repos } = await book()
    const bad = fakeLlm((c) => {
      if (c.role === 'indexer') throw new LlmError('schema', 'bad batch')
      return answer(c)
    })
    await createConceptPass({ bookId: BOOK, repos, llm: bad }).start()
    expect(conceptPassStateKey(BOOK)).toBe(`conceptPass:${BOOK}`)
    expect(await repos.settings.get(conceptPassStateKey(BOOK))).toMatchObject({
      failedSectionIds: expect.arrayContaining([expect.any(String)]),
    })
    // The re-index caller deletes section indexes, then resets this book's pass state.
    await repos.settings.set(conceptPassStateKey('fedcba9876543210'), {
      untouched: true,
    })
    await repos.sectionIndex.deleteByBook(BOOK)
    await resetConceptPassState(repos, BOOK)
    expect(await repos.settings.get(conceptPassStateKey(BOOK))).toBeUndefined()
    expect(
      await repos.settings.get(conceptPassStateKey('fedcba9876543210')),
    ).toEqual({ untouched: true })
    const llm = fakeLlm(answer)
    expect(
      await createConceptPass({ bookId: BOOK, repos, llm }).start(),
    ).toEqual({
      indexed: N,
      total: N,
      done: true,
    })
    expect(llm.calls.some((c) => c.role === 'indexer')).toBe(true)
  })

  test('retryGaps with no gaps makes no calls or book-status changes', async () => {
    const { repos } = await book()
    const llm = fakeLlm(answer)
    const pass = createConceptPass({ bookId: BOOK, repos, llm })
    await pass.start()
    llm.calls.length = 0
    const before = await repos.books.get(BOOK)
    expect(await pass.retryGaps()).toEqual({ indexed: N, total: N, done: true })
    expect(llm.calls).toHaveLength(0)
    expect(await repos.books.get(BOOK)).toEqual(before)
  })

  test('retryGaps waits again if Resume starts another run while it is waiting', async () => {
    const { repos, sections } = await book(5000)
    await createConceptPass({
      bookId: BOOK,
      repos,
      llm: fakeLlm((c) => {
        if (c.role === 'indexer') throw new LlmError('schema', 'bad batch')
        return answer(c)
      }),
    }).start()
    const gate = () => {
      let release!: () => void
      const promise = new Promise<void>((resolve) => {
        release = resolve
      })
      return { promise, release }
    }
    const firstEntered = gate()
    const firstRelease = gate()
    const secondEntered = gate()
    const secondRelease = gate()
    let attempts = 0
    const llm = fakeLlm(async (c) => {
      if (c.role === 'indexer') {
        attempts++
        if (attempts === 1) {
          firstEntered.release()
          await firstRelease.promise
          throw new LlmError('plan-limit', 'limit')
        }
        if (attempts === 2) {
          secondEntered.release()
          await secondRelease.promise
        }
      }
      return answer(c)
    })
    const pass = createConceptPass({ bookId: BOOK, repos, llm })
    const urgent = pass.indexNow(sections[0]!.sectionId, { retryFailed: true })
    await firstEntered.promise
    // Resume's continuation is registered first, so it wins the first run's completion race.
    const resumed = pass.start().then(() => pass.start())
    const retry = pass.retryGaps()
    firstRelease.release()
    await secondEntered.promise
    expect(attempts).toBe(2)
    secondRelease.release()
    expect(await urgent).toBe(false)
    await resumed
    expect(await retry).toEqual({ indexed: N, total: N, done: true })
  })

  test('the public gap type describes progress gaps', () => {
    expectTypeOf<ConceptPassGap>().toEqualTypeOf<'glossary' | 'book-summary'>()
    expectTypeOf<ConceptPassProgress['gaps']>().toEqualTypeOf<
      ConceptPassGap[] | undefined
    >()
  })

  test('Resume after an optional-step usage limit preserves an earlier glossary gap', async () => {
    const { repos } = await book()
    let limit = true
    const llm = fakeLlm((c) => {
      if (c.role === 'glossary') throw new LlmError('schema', 'bad glossary')
      if (c.role === 'book-summary' && limit)
        throw new LlmError('plan-limit', 'limit')
      return answer(c)
    })
    expect(
      await createConceptPass({
        bookId: BOOK,
        repos,
        llm,
        glossaryEvery: 4,
      }).start(),
    ).toMatchObject({
      done: false,
      gaps: ['glossary'],
      error: { code: 'plan-limit' },
    })
    limit = false
    llm.calls.length = 0
    const resumed = createConceptPass({
      bookId: BOOK,
      repos,
      llm,
      glossaryEvery: 4,
    })
    expect(await resumed.start()).toMatchObject({
      done: true,
      indexed: N,
      gaps: ['glossary'],
    })
    expect(llm.calls.some((c) => c.role === 'glossary')).toBe(false)
  })

  test('malformed and obsolete persisted failures do not suppress new indexing', async () => {
    for (const saved of [
      null,
      {
        version: 1,
        indexVersion: -1,
        failedSectionIds: ['irrelevant'],
        gaps: {},
      },
      {
        version: 1,
        indexVersion: 1,
        failedSectionIds: [42, null],
        gaps: { glossary: null },
      },
    ]) {
      const { repos } = await book()
      await repos.settings.set(`conceptPass:${BOOK}`, saved)
      const pass = createConceptPass({
        bookId: BOOK,
        repos,
        llm: fakeLlm(answer),
      })
      expect(await pass.start()).toEqual({ indexed: N, total: N, done: true })
    }
  })

  test('indexNow explicitly retries a remembered section without retrying its failed peers', async () => {
    const { repos, sections } = await book()
    const bad = fakeLlm((c) => {
      if (c.role === 'indexer') throw new LlmError('schema', 'bad batch')
      return answer(c)
    })
    await createConceptPass({ bookId: BOOK, repos, llm: bad }).start()
    const llm = fakeLlm(answer)
    const pass = createConceptPass({ bookId: BOOK, repos, llm })
    // The pipeline automatically calls indexNow for missing sections, including on Resume.
    expect(await pass.indexNow(sections[0]!.sectionId)).toBe(false)
    expect(await pass.indexNow(sections[0]!.sectionId)).toBe(false)
    expect(llm.calls).toHaveLength(0)
    expect(
      await pass.indexNow(sections[0]!.sectionId, { retryFailed: true }),
    ).toBe(true)
    expect(await pass.start()).toMatchObject({
      done: true,
      indexed: 1,
      failed: N - 1,
    })
    expect(llm.calls.filter((c) => c.role === 'indexer')).toHaveLength(1)
  })

  test.each(['glossary', 'book-summary'] as const)(
    '%s still stops on usage limits, sign-in failures, and abort',
    async (role) => {
      for (const code of [
        'plan-limit',
        'signin-required',
        'auth',
        'aborted',
      ] as const) {
        const { repos } = await book()
        const llm = fakeLlm((c) => {
          if (c.role === role) throw new LlmError(code, 'blocked')
          return answer(c)
        })
        const result = await createConceptPass({
          bookId: BOOK,
          repos,
          llm,
        }).start()
        expect(result.done).toBe(false)
        expect(result.gaps).toBeUndefined()
        expect(result.error?.code).toBe(code)
        expect(llm.calls.filter((c) => c.role === role)).toHaveLength(1)
      }
    },
  )

  test('reports both indexer attempts when escalation fails', async () => {
    const { repos } = await book(5000)
    const seen: number[] = []
    const llm = fakeLlm((c) => {
      if (c.role === 'indexer') throw new LlmError('schema', 'bad batch')
      return answer(c)
    })
    await createConceptPass({
      bookId: BOOK,
      repos,
      llm,
      onProgress: () => seen.push(llm.calls.length),
    }).start()
    for (let count = 1; count <= llm.calls.length; count++)
      expect(seen).toContain(count)
  })

  test('pause() aborts the in-flight call and stops', async () => {
    const { repos } = await book()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const llm = fakeLlm(async (c) => {
      await gate
      if (c.opts.signal?.aborted) throw new LlmError('aborted', 'aborted')
      return answer(c)
    })
    const pass = createConceptPass({ bookId: BOOK, repos, llm })
    const run = pass.start()
    await Promise.resolve()
    pass.pause()
    release()
    expect(await run).toMatchObject({ indexed: 0, done: false })
  })
})
