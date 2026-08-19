// @vitest-environment jsdom
// Actual browser request profiles retain full synthetic context so exact replay keys can be audited.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { LlmRequest, SCHEMAS, ground, validate } from '@illus/core'
import type { IrKind, RoleName } from '@illus/core'
import { DEFAULT_MODELS, Fixture, createLlmClient, createPromptRegistry, fixtureKey, memoryFixtures, replayTransport, resolveRoute } from '@illus/llm'
import { expect, test } from 'vitest'

import { BROWSER_ROLES, browserAnswer } from './fixtures/browser-calls.ts'
import { isBrowserFixture, writeFixtureProfile } from './fixtures/profile-writer.ts'
import { ROOT, indexSyntheticBook } from './synthetic-book.ts'

const directory = join(ROOT, 'fixtures/llm')
const promptFiles = Object.fromEntries(readdirSync(join(ROOT, 'docs/prompts')).filter((file) => file.endsWith('.md')).map((file) => [file, readFileSync(join(ROOT, 'docs/prompts', file), 'utf8')]))
const prompts = createPromptRegistry(promptFiles)

function loadBrowserFixtures(): Fixture[] {
  return BROWSER_ROLES.flatMap((role) => readdirSync(join(directory, role)).filter((file) => file.endsWith('.json')).map((file) => Fixture.parse(JSON.parse(readFileSync(join(directory, role, file), 'utf8'))))).filter(isBrowserFixture)
}

test('captured browser contexts replay by their exact hashes and ground only in their supplied synthetic blocks', async () => {
  const book = await indexSyntheticBook()
  if (process.env.ILLUS_WRITE_BROWSER_FIXTURES === '1') {
    if (!process.env.ILLUS_BROWSER_REQUESTS) throw new Error('ILLUS_BROWSER_REQUESTS must name the captured request JSON array')
    const raw: unknown = JSON.parse(readFileSync(process.env.ILLUS_BROWSER_REQUESTS, 'utf8'))
    if (!Array.isArray(raw)) throw new Error('browser capture must be a JSON array of LlmRequest')
    const captured = raw.map((request: unknown) => LlmRequest.parse(request)).filter((request) => (BROWSER_ROLES as readonly RoleName[]).includes(request.role))
    expect(captured.length).toBeGreaterThan(0)
    const fixtures: Fixture[] = []
    for (const request of captured) {
      const route = resolveRoute(DEFAULT_MODELS, request.role, request.escalate).chain[0]!
      fixtures.push({
        key: await fixtureKey({ ...request, model: route.model }), source: 'handwritten',
        role: request.role, promptVersion: request.promptVersion, model: route.model, effort: route.effort,
        schemaName: request.schemaName, ...(request.templateId && { templateId: request.templateId }),
        prefix: request.prefix, body: request.body, data: SCHEMAS[request.schemaName].parse(browserAnswer(book, request)),
        usage: { input: Math.ceil((request.prefix.length + request.body.length) / 4), output: 200, cachedInput: 0 },
        note: `synthetic.epub browser: ${request.role}; exact captured context, handwritten answer from browser-calls.ts.`,
      })
    }
    // Extend the profile across capture stages; only explicitly regenerated keys are replaced.
    const merged = new Map(loadBrowserFixtures().map((fixture) => [fixture.key, fixture]))
    for (const fixture of fixtures) merged.set(fixture.key, fixture)
    writeFixtureProfile(directory, BROWSER_ROLES, [...merged.values()], isBrowserFixture)
  }
  const fixtures = loadBrowserFixtures()
  expect(fixtures.length).toBeGreaterThan(0)
  const store = await memoryFixtures(fixtures)
  const client = createLlmClient({ transport: replayTransport({ fixtures: store, models: DEFAULT_MODELS }), prompts })
  for (const fixture of fixtures) {
    expect(fixture.prefix).toBeTypeOf('string')
    expect(fixture.body).toBeTypeOf('string')
    const context = { prefix: fixture.prefix!, body: fixture.body! }
    expect(await fixtureKey({ ...fixture, ...context })).toBe(fixture.key)
    expect(fixture.promptVersion).toBe(prompts.get(fixture.role).version)
    const escalated = fixture.model !== resolveRoute(DEFAULT_MODELS, fixture.role, false).chain[0]!.model
    const result = await client.call(fixture.role, context, { schemaName: fixture.schemaName as never, ...(fixture.templateId && { templateId: fixture.templateId }), ...(escalated && { escalate: true }) })
    expect(result.data).toEqual(SCHEMAS[fixture.schemaName].parse(fixture.data))
    const ids = new Set([...context.body.matchAll(/<block id="([^"]+)"/g)].map((match) => match[1]!))
    const blocks = new Map(book.blocks.filter((block) => ids.has(block.blockId)).map((block) => [block.blockId, block]))
    expect([...ids].every((id) => blocks.has(id))).toBe(true)
    if (fixture.role.startsWith('extractor.')) {
      const kind = (fixture.data as { type: IrKind }).type
      const checked = validate(kind, result.data, { blocks, ground })
      expect(checked.report.ok, JSON.stringify(checked.report)).toBe(true)
      expect(checked.report.groundingScore).toBeGreaterThan(0.6)
    }
  }
}, 30_000)
