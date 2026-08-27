import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { LlmRequest, TemplateIR } from '@illus/core'
import { createPromptRegistry, Fixture, memoryFixtures } from '@illus/llm'
import { exampleIR, listTemplates } from '@illus/render/templates'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createReaderIllusServer } from './server-config'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const temporary: string[] = []
const env = { ILLUS_SESSION_SECRET: 's'.repeat(32), ILLUS_LLM_MODE: 'replay' }
const noNetwork = vi.fn(() => {
  throw new Error('template replay must never call the network')
})

afterEach(async () => {
  expect(noNetwork).not.toHaveBeenCalled()
  vi.clearAllMocks()
  await Promise.all(
    temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

async function prompts() {
  return createPromptRegistry({
    'extractor.template.md': await readFile(
      join(root, 'docs/prompts/extractor.template.md'),
      'utf8',
    ),
  })
}

async function dataDirectory() {
  const dir = await mkdtemp(join(tmpdir(), 'reader-template-'))
  temporary.push(dir)
  return dir
}

async function setup(data: TemplateIR) {
  const registry = await prompts()
  const request: LlmRequest = {
    role: 'extractor.template',
    schemaName: 'TemplateIR',
    templateId: data.templateId,
    promptVersion: registry.get('extractor.template').version,
    prefix: 'template fixture',
    body: 'template example',
    requestId: 'template-replay',
  }
  const fixtures = await memoryFixtures([
    {
      ...request,
      source: 'handwritten',
      model: 'gpt-6.1-sol',
      effort: 'medium',
      data,
    },
  ])
  const dataDir = await dataDirectory()
  const server = await createReaderIllusServer(
    { ...env, ILLUS_DATA_DIR: dataDir },
    { prompts: registry, fixtures, fetch: noNetwork },
  )
  return { server, request, dataDir }
}

describe('reader server template capability', () => {
  it.each(
    listTemplates().map(
      (template) => [template.id, exampleIR(template)] as const,
    ),
  )(
    'replays valid %s props through the factory without a browser flag',
    async (_id, data) => {
      const { server, request, dataDir } = await setup(data)
      expect(
        await server.gateway.handle(request, { session: true }),
      ).toMatchObject({
        status: 200,
        body: { ok: true, data },
      })
      const rows = (await readFile(join(dataDir, 'usage.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((row) => JSON.parse(row))
      expect(rows).toEqual([
        expect.objectContaining({
          role: 'extractor.template',
          mode: 'replay',
          outcome: 'ok',
          attempts: 0,
        }),
      ])
    },
  )

  it.each([{ values: [] }, { values: 'not an array' }, { cells: [1] }])(
    'rejects malformed array props %j using the W5 schema',
    async (props) => {
      const { server, request } = await setup({
        type: 'template',
        templateId: 'array',
        props,
        evidence: [],
      })
      expect(
        await server.gateway.handle(request, { session: true }),
      ).toMatchObject({
        status: 422,
        body: {
          ok: false,
          code: 'schema',
          issues: [expect.objectContaining({ path: ['props', 'values'] })],
        },
      })
    },
  )

  it('rejects a fixture for a template other than the requested templateId', async () => {
    const { server, request } = await setup({
      type: 'template',
      templateId: 'array',
      props: { values: [1] },
      evidence: [],
    })
    expect(
      await server.gateway.handle(
        { ...request, templateId: 'stack' },
        { session: true },
      ),
    ).toMatchObject({
      status: 422,
      body: {
        ok: false,
        code: 'schema',
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ['templateId'] }),
        ]),
      },
    })
  })

  it('keeps session, role/schema and required templateId checks before replay', async () => {
    const { server, request } = await setup({
      type: 'template',
      templateId: 'array',
      props: { values: [1] },
      evidence: [],
    })
    expect(
      await server.gateway.handle(request, { session: false }),
    ).toMatchObject({ status: 401, body: { code: 'auth' } })
    for (const change of [
      { role: 'planner' },
      { schemaName: 'GraphIR' },
      { templateId: undefined },
      { templateId: 'unregistered' },
    ]) {
      expect(
        await server.gateway.handle(
          { ...request, ...change },
          { session: true },
        ),
      ).toMatchObject({ status: 400, body: { ok: false, code: 'upstream' } })
    }
  })

  // ADR 0041 (resolved): W3 regenerated the synthetic fixture against W5's array schema.
  it('replays the repository template fixture using the selected W5 schema', async () => {
    const files = await readdir(join(root, 'fixtures/llm/extractor.template'))
    const fixture = Fixture.parse(
      JSON.parse(
        await readFile(
          join(
            root,
            'fixtures/llm/extractor.template',
            files.find((file) => file.endsWith('.json'))!,
          ),
          'utf8',
        ),
      ),
    )
    // Older public synthetic fixtures store only the hash, not its prompt inputs. Rekey the actual
    // disk answer with this test's context; the factory's disk-envelope tests cover file loading.
    const { server, request } = await setup(fixture.data as TemplateIR)
    expect(fixture).toMatchObject({
      role: request.role,
      schemaName: request.schemaName,
      promptVersion: request.promptVersion,
    })
    expect(
      await server.gateway.handle(request, { session: true }),
    ).toMatchObject({ status: 200, body: { ok: true, data: fixture.data } })
  })
})
