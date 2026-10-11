import { LlmError, ROLES, resolveFlags, sectionContentHash } from '@illus/core'
import type {
  IllusRepos,
  LlmCall,
  LlmCallOptions,
  LlmContext,
  RoleName,
} from '@illus/core'
import {
  CHAPTER_ID,
  SECTION_COMMIT_ID,
  SECTION_LEADERS_ID,
  buildSmallBook,
  createMemoryRepos,
  make,
} from '@illus/core/testing'
import { DEFAULT_MODELS } from '@illus/llm'

import { createPipeline } from '../src/index.ts'
import type {
  PipelineDeps,
  SectionJob,
  SectionJobEvent,
  SectionJobEvents,
} from '../src/index.ts'

export interface Call {
  role: RoleName
  ctx: LlmContext
  opts: LlmCallOptions<string>
}

export type Answer = (c: Call) => unknown | Promise<unknown>

/** A typed fake `LlmCall`: answers by role; escalated calls report the deep-tier model. */
export function fakeLlm(answer: Answer): LlmCall & { calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    async call(role, ctx, opts = {}) {
      const c: Call = { role, ctx, opts: opts as LlmCallOptions<string> }
      calls.push(c)
      const data = await answer(c)
      if (opts.signal?.aborted) throw new LlmError('aborted', 'aborted')
      return {
        data: data as never,
        model: opts.escalate ? 'gpt-6-astra' : 'gpt-6.1-sol',
        effort: ROLES[role].effort,
        promptVersion: '1.0.0',
        usage: { input: 100, output: 10, cachedInput: 0 },
        latencyMs: 1,
        requestId: `r${calls.length}`,
      }
    },
  }
}

export const prompts = {
  get: () => ({ version: '1.0.0', budgetTokens: 12_000 }),
}

export async function seededRepos(): Promise<IllusRepos> {
  const book = await buildSmallBook()
  const repos = createMemoryRepos()
  await repos.books.put(book.book)
  await repos.sections.bulkPut(book.sections)
  await repos.blocks.bulkPut(book.blocks)
  await repos.crossRefs.bulkAdd(book.crossRefs)
  await repos.sectionIndex.bulkPut([
    make.sectionIndexRecord({
      sectionId: CHAPTER_ID,
      defines: [],
      uses: [],
      summary: 'How servers keep one log.',
    }),
    make.sectionIndexRecord(),
    make.sectionIndexRecord({
      sectionId: SECTION_COMMIT_ID,
      defines: [],
      uses: [],
      summary: 'Commit rule.',
    }),
  ])
  await repos.concepts.bulkPut(book.concepts)
  return repos
}

/** A trace test needs an actual code block in the current section, permitted by packed context. */
export const TRACE_CODE_ID = `${SECTION_LEADERS_ID}#b5`
export async function seededTraceRepos(): Promise<IllusRepos> {
  const repos = await seededRepos()
  const source = (await repos.blocks.get(`${SECTION_COMMIT_ID}#b1`))!
  await repos.blocks.put({
    ...source,
    blockId: TRACE_CODE_ID,
    sectionId: SECTION_LEADERS_ID,
  })
  const section = (await repos.sections.get(SECTION_LEADERS_ID))!
  const blocks = await repos.blocks.listBySection(SECTION_LEADERS_ID)
  await repos.sections.put({
    ...section,
    blockIds: [...section.blockIds, TRACE_CODE_ID],
    contentHash: await sectionContentHash(blocks.map((b) => b.text)),
  })
  return repos
}

/** Every flag off, so tests do not follow the app defaults; tests opt in per flag. */
export const flagsOff = (on: Parameters<typeof resolveFlags>[0] = {}) =>
  resolveFlags({ templates: false, animations: false, ...(on as object) })

export function pipelineWith(
  repos: IllusRepos,
  llm: LlmCall,
  over: Partial<PipelineDeps> = {},
) {
  return createPipeline({
    repos,
    llm,
    prompts,
    models: DEFAULT_MODELS,
    flags: flagsOff(),
    ...over,
  })
}

/** Collects every event of a job until `done`. */
export async function collect(job: SectionJob) {
  const events: {
    type: SectionJobEvent
    payload: SectionJobEvents[SectionJobEvent]
  }[] = []
  const types: SectionJobEvent[] = [
    'plan',
    'no-visual',
    'item-progress',
    'item-preview',
    'item-ready',
    'item-failed',
    'error',
    'done',
  ]
  for (const type of types)
    job.on(type, (payload) => events.push({ type, payload }))
  await job.finished
  return {
    events,
    of: <E extends SectionJobEvent>(type: E) =>
      events
        .filter((e) => e.type === type)
        .map((e) => e.payload as SectionJobEvents[E]),
  }
}

export { CHAPTER_ID, SECTION_COMMIT_ID, SECTION_LEADERS_ID }
