// @vitest-environment jsdom
// End to end on replay fixtures: synthetic.epub → W1 structural index → concept pass → requestSection for
// every non-template IR kind (plus template, no-visual and mergedInto), through the real @illus/llm
// client in replay mode. `pnpm --filter @illus/pipeline fixtures:llm` (ILLUS_WRITE_FIXTURES=1) runs the
// same flow and rewrites fixtures/llm/<role>/ for the W3 roles from test/fixtures/synthetic-calls.ts.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { createConceptPass } from '@illus/concepts'
import { SCHEMAS, resolveFlags } from '@illus/core'
import type { IrKind, LlmRequest, LlmResponse, RoleName, VisualRecord } from '@illus/core'
import { DEFAULT_MODELS, createLlmClient, createPromptRegistry, fixtureKey, memoryFixtures, replayTransport, resolveRoute } from '@illus/llm'
import type { Fixture, FixtureStore, LlmTransport } from '@illus/llm'
// eslint-disable-next-line no-restricted-imports -- the published DOM-free template entry (ADR 0040)
import { templateRegistry } from '@illus/render/templates'
import { beforeAll, describe, expect, test } from 'vitest'

import { createPipeline } from '../src/index.ts'
import type { Pipeline } from '../src/index.ts'
import { BOOK_SUMMARY, EXTRACTS, GLOSSARY, INDEX, PLANS, sectionKey } from './fixtures/synthetic-calls.ts'
import { isCompleteFixture, writeFixtureProfile } from './fixtures/profile-writer.ts'
import { collect } from './helpers.ts'
import { ROOT, indexSyntheticBook } from './synthetic-book.ts'
import type { IndexedBook } from './synthetic-book.ts'

const W3_ROLES: RoleName[] = [
  'indexer',
  'glossary',
  'book-summary',
  'planner',
  'extractor.graph',
  'extractor.mermaid',
  'extractor.template',
  'extractor.chart',
  'extractor.math',
  'extractor.timeline',
]
const FIXTURES = join(ROOT, 'fixtures/llm')
const WRITE = process.env.ILLUS_WRITE_FIXTURES === '1'

const promptFiles = Object.fromEntries(
  readdirSync(join(ROOT, 'docs/prompts'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => [f, readFileSync(join(ROOT, 'docs/prompts', f), 'utf8')]),
)
const prompts = createPromptRegistry(promptFiles)

/** Replaces '@b<n>' with block ids of `sectionId` throughout an answer. */
function resolve<T>(value: T, sectionId: string): T {
  return JSON.parse(JSON.stringify(value), (_k, v: unknown) => (typeof v === 'string' && /^@b\d+$/.test(v) ? `${sectionId}#${v.slice(1)}` : v)) as T
}

/** Answers a request from the hand-written data (generator mode). */
function handwritten(book: IndexedBook, req: LlmRequest): unknown {
  const ids = [...req.body.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]!)
  const section = (id: string) => book.sections.find((s) => s.sectionId === id)!
  const key = (id: string) => sectionKey(section(id), book.sections)
  switch (req.role) {
    case 'indexer':
      return { sections: ids.map((id) => resolve({ sectionId: id, ...INDEX[key(id)!] }, id)) }
    case 'glossary':
      return GLOSSARY
    case 'book-summary':
      return /Chapter 4/.test(req.body) ? BOOK_SUMMARY.final : BOOK_SUMMARY.early
    case 'planner': {
      const plan = PLANS[key(ids[0]!)!]
      if (!plan) throw new Error(`no hand-written plan for ${section(ids[0]!).title}`)
      return resolve({ sectionId: ids[0]!, ...plan }, ids[0]!)
    }
    default: {
      const item = /<plan_item id="([^"]+)"/.exec(req.body)![1]!
      const data = EXTRACTS[`${key(ids[0]!)}|${item}`]
      if (!data) throw new Error(`no hand-written ${req.role} answer for ${section(ids[0]!).title} ${item}`)
      return resolve(data, ids[0]!)
    }
  }
}

/** Generator transport: answers from the hand-written data and records each answer as a fixture. */
function writingTransport(book: IndexedBook, written: Fixture[]): LlmTransport {
  return async (req): Promise<LlmResponse> => {
    const route = resolveRoute(DEFAULT_MODELS, req.role, req.escalate).chain[0]!
    const data = handwritten(book, req)
    const fixture: Fixture = {
      key: await fixtureKey({ role: req.role, promptVersion: req.promptVersion, model: route.model, prefix: req.prefix, body: req.body }),
      source: 'handwritten',
      role: req.role,
      promptVersion: req.promptVersion,
      model: route.model,
      effort: route.effort,
      schemaName: req.schemaName,
      ...(req.templateId && { templateId: req.templateId }),
      data,
      usage: { input: Math.ceil((req.prefix.length + req.body.length) / 4), output: 200, cachedInput: 0 },
      note: `synthetic.epub: ${req.role} for ${[...new Set([...req.body.matchAll(/<section id="([^"]+)"/g)].map((m) => book.sections.find((s) => s.sectionId === m[1])!.title.trim()))].join(', ')}${/<plan_item id="([^"]+)"/.exec(req.body)?.[0].replace('<plan_item ', ' ') ?? ''}. Written from packages/illus-pipeline/test/fixtures/synthetic-calls.ts.`,
    }
    written.push(fixture)
    return { ok: true, data, usage: fixture.usage!, model: route.model, effort: route.effort, latencyMs: 0 }
  }
}

function loadFixtures(): unknown[] {
  return W3_ROLES.flatMap((role) => {
    let files: string[] = []
    try {
      files = readdirSync(join(FIXTURES, role)).filter((f) => f.endsWith('.json'))
    } catch {
      return []
    }
    return files.map((f) => JSON.parse(readFileSync(join(FIXTURES, role, f), 'utf8')) as { note?: string })
      .filter((f) => !f.note?.startsWith('synthetic.epub browser:'))
  })
}

describe('synthetic.epub end to end on replay fixtures', () => {
  let book: IndexedBook
  let pipeline: Pipeline
  const written: Fixture[] = []
  const used = new Set<string>()
  let store: FixtureStore & { all(): Fixture[] }

  beforeAll(async () => {
    book = await indexSyntheticBook()
    store = await memoryFixtures(WRITE ? [] : loadFixtures())
    const tracking: FixtureStore = { get: async (k) => (used.add(k), store.get(k)) }
    const transport = WRITE ? writingTransport(book, written) : replayTransport({ fixtures: tracking, models: DEFAULT_MODELS })
    const llm = createLlmClient({ transport, prompts, newRequestId: () => 'req', now: () => 1 })
    const pass = createConceptPass({ bookId: book.bookId, repos: book.repos, llm, now: () => 1 })
    const progress = await pass.start()
    if (progress.error) throw progress.error
    pipeline = createPipeline({
      repos: book.repos,
      llm,
      prompts,
      models: DEFAULT_MODELS,
      flags: resolveFlags({ templates: true, animations: false }),
      concepts: pass,
      lexical: book.lexical,
      templates: templateRegistry,
      now: () => 1,
    })
  }, 60_000)

  test('the concept pass indexes every section, merges the glossary and writes the book summary', async () => {
    expect(await book.repos.sectionIndex.countByBook(book.bookId)).toBe(book.sections.length)
    const meta = await book.repos.books.get(book.bookId)
    expect(meta).toMatchObject({ indexStatus: 'complete', summary: BOOK_SUMMARY.final })
    const concepts = await book.repos.concepts.listByBook(book.bookId)
    expect(concepts.find((c) => c.canonical === 'replicated log')).toMatchObject({ aliases: ['log'], spanning: true })
    expect(concepts.find((c) => c.canonical === 'loop invariant')?.definition?.start).toBeTypeOf('number')
  })

  const ready = async (key: string, opts = {}) => {
    const section = book.sections.find((s) => sectionKey(s, book.sections) === key)!
    const r = await collect(pipeline.requestSection(section.sectionId, opts))
    expect(r.of('error')).toEqual([])
    expect(r.of('item-failed')).toEqual([])
    return { r, records: Object.fromEntries(r.of('item-ready').map((e) => [e.planItemId, e.record])) as Record<string, VisualRecord> }
  }
  const expectValid = (record: VisualRecord | undefined, kind: IrKind) => {
    expect(record?.kind).toBe(kind)
    expect(record!.validation).toMatchObject({ ok: true, retried: false, escalated: false })
    expect(record!.validation.groundingScore).toBeGreaterThan(0.6)
    const schema = { graph: 'GraphIR', sequence: 'SequenceIR', state: 'StateIR', class: 'ClassIR', er: 'ErIR', template: 'TemplateIR', chart: 'ChartIR', math: 'MathIR', timeline: 'TimelineIR', html: 'HtmlIR' } as const
    expect(SCHEMAS[schema[kind]].safeParse(record!.ir).success).toBe(true)
    expect(record!.spec).toBeNull()
  }

  test('graph, state and class (3.1, part 1)', async () => {
    const { records } = await ready('long1')
    expectValid(records.p1, 'graph')
    expectValid(records.p2, 'state')
    expectValid(records.p3, 'class')
  })

  test('sequence and timeline (3.1, part 2)', async () => {
    const { records } = await ready('long2')
    expectValid(records.p1, 'sequence')
    expectValid(records.p2, 'timeline')
  })

  test('er (1.1)', async () => {
    expectValid((await ready('1.1')).records.p1, 'er')
  })

  test('math and chart (2.1); requesting the merged chapter 2 resolves to 2.1 from the cache', async () => {
    const { records } = await ready('2.1')
    expectValid(records.p1, 'math')
    expectValid(records.p2, 'chart')
    const again = await ready('ch2')
    expect(again.r.of('plan')[0]!.fromCache).toBe(true)
    expect(again.r.of('item-ready').every((e) => e.fromCache)).toBe(true)
  })

  test('binary search uses symbolic bounds; trace stays hidden while its flag is off', async () => {
    const { r, records } = await ready('1.2')
    expect(r.of('plan')[0]!.plan.items.map((i) => i.kind)).toEqual(['graph'])
    expectValid(records.p1, 'graph')
  })

  test('template (2.2, templates flag on) represents only the five entries stated by Figure 2.2', async () => {
    const { records } = await ready('2.2')
    expectValid(records.p1, 'template')
    expect(records.p1!.ir).toMatchObject({ props: { label: 'Log', values: ['entry', 'entry', 'entry', 'entry', 'entry'] } })
  })

  test('no visual for chapter 4', async () => {
    const section = book.sections.find((s) => sectionKey(s, book.sections) === 'ch4')!
    const r = await collect(pipeline.requestSection(section.sectionId))
    expect(r.of('no-visual')).toEqual([{ reason: PLANS.ch4!.reason }])
  })

  test('fixtures: every committed W3 fixture is hand-written and used (or rewritten in generator mode)', () => {
    if (WRITE) {
      writeFixtureProfile(FIXTURES, W3_ROLES, written, isCompleteFixture)
      expect(new Set(written.map((f) => f.role))).toEqual(new Set(W3_ROLES))
      return
    }
    const all = store.all()
    expect(all.every((f) => f.source === 'handwritten')).toBe(true)
    expect(new Set(all.map((f) => f.role))).toEqual(new Set(W3_ROLES))
    expect(all.filter((f) => !used.has(f.key!)).map((f) => f.note)).toEqual([])
  })
})
