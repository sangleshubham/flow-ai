import { LlmError, makeBlockId, makeSectionId } from '@illus/core'
import type { Block, IndexerOutput, LlmCall, LlmContext, LlmCallOptions, RoleName, SectionNode } from '@illus/core'
import { createMemoryRepos, make } from '@illus/core/testing'
import { describe, expect, test } from 'vitest'

import { createConceptPass } from '../src/index.ts'

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
      return { data: data as never, model: 'gpt-6-luna', effort: 'medium', promptVersion: '1.0.0', usage: { input: 1, output: 1, cachedInput: 0 }, latencyMs: 1, requestId: 'r' }
    },
  }
}

/** N one-block sections; section k defines "term k", the first uses "leader". */
async function book(tokenEstimate = 2000) {
  const repos = createMemoryRepos()
  const sections: SectionNode[] = []
  const blocks: Block[] = []
  for (let k = 0; k < N; k++) {
    const sectionId = makeSectionId({ bookId: BOOK, spineIndex: k, headingPath: [`S${k}`], ordinalInSpine: 0 })
    const blockId = makeBlockId(sectionId, 0)
    blocks.push({ blockId, sectionId, kind: 'paragraph', text: `Here term ${k} is defined as a thing the leader uses.`, cfiRange: 'epubcfi(/6/2!/4/2)' })
    sections.push(make.sectionNode({ sectionId, ordinal: k, level: 1, title: `S${k}`, headingPath: [`S${k}`], parentId: undefined, blockIds: [blockId], tokenEstimate }))
  }
  await repos.books.put(make.bookMeta({ sectionCount: N }))
  await repos.sections.bulkPut(sections)
  await repos.blocks.bulkPut(blocks)
  return { repos, sections }
}

/** Indexer answers from the batch body; definitions of odd sections carry a quote that does not ground. */
function answer(c: Call): unknown {
  if (c.role === 'indexer') {
    const ids = [...c.ctx.body.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]!)
    const out: IndexerOutput = {
      sections: ids.map((sectionId) => {
        const k = Number(/:(\d+):s/.exec(sectionId)![1])
        return {
          sectionId,
          summary: `Section ${k}.`,
          defines: [{ name: `term ${k}`, evidence: { blockId: makeBlockId(sectionId, 0), quote: k % 2 ? 'words that are not there' : `term ${k} is defined` } }],
          uses: [{ name: k === 0 ? 'leader' : 'leaders' }, { name: k === 3 ? 'log' : 'replicated log' }],
          flags: make.sectionIndexOutput().flags,
        }
      }),
    }
    return out
  }
  if (c.role === 'glossary') return { merges: [{ canonical: 'replicated log', aliases: ['log'] }] }
  return { summary: `Summary from ${c.ctx.body.split('<summary ').length - 1} sections.`, conventions: ['Terms are numbered.'] }
}

describe('concept pass', () => {
  test('keeps complete block arrays per section, including empty and multi-block sections', async () => {
    const { repos, sections } = await book()
    const empty = sections[0]!
    await repos.blocks.delete(empty.blockIds[0]!)
    await repos.sections.put({ ...empty, blockIds: [], tokenEstimate: 0 })
    const multi = sections[1]!
    const extra = { ...(await repos.blocks.get(multi.blockIds[0]!))!, blockId: makeBlockId(multi.sectionId, 1), text: 'A second paragraph belongs to this same section.' }
    await repos.blocks.put(extra)
    await repos.sections.put({ ...multi, blockIds: [...multi.blockIds, extra.blockId] })
    const llm = fakeLlm(answer)
    expect(await createConceptPass({ bookId: BOOK, repos, llm }).start()).toMatchObject({ indexed: N, done: true })
    expect(await repos.sectionIndex.get(empty.sectionId)).toMatchObject({ summary: empty.title, indexedWith: { model: 'none' } })
    const batches = llm.calls.filter((call) => call.role === 'indexer')
    expect(batches.every((call) => !call.ctx.body.includes(`<section id="${empty.sectionId}"`))).toBe(true)
    const request = batches.find((call) => call.ctx.body.includes(`<section id="${multi.sectionId}"`))!
    expect(request.ctx.body).toContain(`id="${multi.blockIds[0]}"`)
    expect(request.ctx.body).toContain(`id="${extra.blockId}"`)
    expect(request.ctx.body).toContain(extra.text)
  })

  test('indexes in batches, grounds definitions, merges the glossary, summarises at 30% and at completion', async () => {
    const { repos, sections } = await book()
    const llm = fakeLlm(answer)
    const progress: number[] = []
    const pass = createConceptPass({ bookId: BOOK, repos, llm, now: () => 5, onProgress: (p) => progress.push(p.indexed) })
    const done = await pass.start()
    expect(done).toEqual({ indexed: N, total: N, done: true })
    // 2,000-token sections → 4 per 8,000-token batch.
    expect(llm.calls.filter((c) => c.role === 'indexer').map((c) => c.ctx.body.split('<section ').length - 1)).toEqual([4, 4, 2])
    expect(progress).toEqual([4, 8, 10])
    expect(llm.calls.map((c) => c.role)).toEqual(['indexer', 'book-summary', 'indexer', 'indexer', 'glossary', 'book-summary'])
    // The first summary saw 4 sections; the second all 10. Later indexer calls carry the summary in the prefix.
    expect(llm.calls[1]!.ctx.body.split('<summary ').length - 1).toBe(4)
    expect(llm.calls[2]!.ctx.prefix).toContain('<summary>Summary from 4 sections.</summary>')
    expect((await repos.books.get(BOOK))!.summary!.summary).toBe('Summary from 10 sections.')
    expect(llm.calls[4]!.ctx.body).toContain('<cluster><name>log</name></cluster>')

    const r0 = await repos.sectionIndex.get(sections[0]!.sectionId)
    expect(r0!.defines[0]!.evidence).toMatchObject({ start: 5, end: 22 })
    expect(r0!.indexedWith).toEqual({ model: 'gpt-6-luna', promptVersion: '1.0.0' })
    expect((await repos.sectionIndex.get(sections[1]!.sectionId))!.defines).toEqual([])

    const concepts = await repos.concepts.listByBook(BOOK)
    const leader = concepts.find((c) => c.canonical === 'leaders' || c.canonical === 'leader')!
    expect(leader).toMatchObject({ firstOrdinal: 0, spanning: true, aliases: [expect.any(String)] })
    expect(concepts.find((c) => c.canonical === 'replicated log')).toMatchObject({ aliases: ['log'], usedInSectionIds: sections.map((s) => s.sectionId) })
    expect(concepts.find((c) => c.canonical === 'term 0')).toMatchObject({ definedInSectionId: sections[0]!.sectionId, spanning: false })

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
    const order = llm.calls.filter((c) => c.role === 'indexer').map((c) => /:(\d+):s/.exec(c.ctx.body)![1])
    expect(order.slice(0, 2)).toEqual(['8', '6'])
  })

  test('a plan limit stops the pass with the error; start() resumes where it stopped', async () => {
    const { repos } = await book()
    let limit = true
    const llm = fakeLlm((c) => {
      if (c.role === 'indexer' && limit && llm.calls.filter((x) => x.role === 'indexer').length === 2) throw new LlmError('plan-limit', 'limit')
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
      if (c.role === 'indexer' && !c.opts.escalate && llm.calls.length === 1) throw new LlmError('schema', 'bad')
      return answer(c)
    })
    await createConceptPass({ bookId: BOOK, repos, llm }).start()
    expect(llm.calls.slice(0, 2).map((c) => [c.role, c.opts.escalate ?? false])).toEqual([['indexer', false], ['indexer', true]])
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
