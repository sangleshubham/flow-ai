import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LlmRequest, VisualPlan } from '@illus/core'
import { Fixture, createPromptRegistry, keyOfFixture } from '@illus/llm'
import { fileFixtures } from '@illus/llm/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createReaderIllusServer,
  resolveReaderFixturesDir,
} from './server-config'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const temporary: string[] = []
const env = { ILLUS_SESSION_SECRET: 's'.repeat(32), ILLUS_LLM_MODE: 'replay' }

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

async function temporaryDirectory() {
  const dir = await mkdtemp(join(tmpdir(), 'reader-fixtures-'))
  temporary.push(dir)
  return dir
}

async function promptRegistry() {
  const dir = join(root, 'docs/prompts')
  const files = await readdir(dir)
  return createPromptRegistry(
    Object.fromEntries(
      await Promise.all(
        files
          .filter((f) => f.endsWith('.md'))
          .map(async (f) => [f, await readFile(join(dir, f), 'utf8')]),
      ),
    ),
  )
}

describe('reader fixture directory', () => {
  it.each([root, join(root, 'apps/reader')])(
    'uses the workspace fixtures when launched from %s',
    (cwd) => {
      expect(resolveReaderFixturesDir({}, cwd)).toBe(join(root, 'fixtures/llm'))
    },
  )

  it('uses the closest workspace, including an isolated worktree', async () => {
    const dir = await temporaryDirectory()
    const nested = join(dir, '.worktrees/reader')
    await mkdir(join(nested, 'apps/reader'), { recursive: true })
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages: []\n')
    await writeFile(join(nested, 'pnpm-workspace.yaml'), 'packages: []\n')
    expect(resolveReaderFixturesDir({}, join(nested, 'apps/reader'))).toBe(
      join(nested, 'fixtures/llm'),
    )
  })

  it.each(['/mounted/fixtures', 'custom/fixtures'])(
    'preserves explicit override %s even outside a workspace',
    async (override) => {
      expect(
        resolveReaderFixturesDir(
          { ILLUS_FIXTURES_DIR: override },
          await temporaryDirectory(),
        ),
      ).toBe(override)
    },
  )

  it('fails clearly without a workspace or explicit directory', async () => {
    const dir = await temporaryDirectory()
    expect(() => resolveReaderFixturesDir({}, dir)).toThrow(
      /ILLUS_FIXTURES_DIR/,
    )
  })
})

describe('reader disk fixture integration', () => {
  it('records to the workspace directory and replays from an explicit override outside a workspace', async () => {
    const workspace = await temporaryDirectory()
    const cwd = join(workspace, 'apps/reader')
    await mkdir(cwd, { recursive: true })
    await writeFile(join(workspace, 'pnpm-workspace.yaml'), 'packages: []\n')
    vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    const plannerFiles = await readdir(join(root, 'fixtures/llm/planner'))
    const plan = VisualPlan.parse(
      Fixture.parse(
        JSON.parse(
          await readFile(
            join(
              root,
              'fixtures/llm/planner',
              plannerFiles.find((f) => f.endsWith('.json'))!,
            ),
            'utf8',
          ),
        ),
      ).data,
    )
    const fetch = vi.fn(
      async () =>
        new Response(
          `event: response.completed\ndata: ${JSON.stringify({
            type: 'response.completed',
            sequence_number: 0,
            response: {
              id: 'resp_test',
              object: 'response',
              status: 'completed',
              output: [
                {
                  type: 'message',
                  id: 'm1',
                  role: 'assistant',
                  status: 'completed',
                  content: [
                    {
                      type: 'output_text',
                      text: JSON.stringify(plan),
                      annotations: [],
                    },
                  ],
                },
              ],
              usage: {
                input_tokens: 120,
                output_tokens: 40,
                total_tokens: 160,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens_details: { reasoning_tokens: 0 },
              },
            },
          })}\n\n`,
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    )
    const prompts = await promptRegistry()
    const record = await createReaderIllusServer(
      {
        ...env,
        ILLUS_LLM_MODE: 'record',
        ILLUS_DATA_DIR: join(workspace, 'data'),
        ILLUS_LLM_PROVIDER: 'openai-api-key',
        ILLUS_OPENAI_API_KEY: 'sk-test-only',
      },
      { prompts, fetch },
    )
    const request = LlmRequest.parse({
      role: 'planner',
      promptVersion: prompts.get('planner').version,
      schemaName: 'VisualPlan',
      prefix: 'P',
      body: 'B',
      requestId: 'reader-record',
    })
    expect(
      await record.gateway.handle(request, { session: true }),
    ).toMatchObject({ status: 200, body: { ok: true, data: plan } })
    expect(fetch).toHaveBeenCalledTimes(1)
    const dir = join(workspace, 'fixtures/llm')
    const files = await readdir(join(dir, 'planner'))
    expect(files).toHaveLength(1)
    expect(
      JSON.parse(await readFile(join(dir, 'planner', files[0]!), 'utf8')),
    ).toMatchObject({ source: 'recorded', data: plan })
    vi.mocked(process.cwd).mockReturnValue(await temporaryDirectory())
    const replay = await createReaderIllusServer(
      {
        ...env,
        ILLUS_DATA_DIR: join(workspace, 'replay-data'),
        ILLUS_FIXTURES_DIR: dir,
      },
      { prompts, fetch },
    )
    expect(
      await replay.gateway.handle(request, { session: true }),
    ).toMatchObject({ status: 200, body: { ok: true, data: plan } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not require a fixture directory in live mode', async () => {
    const dir = await temporaryDirectory()
    vi.spyOn(process, 'cwd').mockReturnValue(dir)
    const server = await createReaderIllusServer(
      {
        ...env,
        ILLUS_LLM_MODE: 'live',
        ILLUS_DATA_DIR: dir,
        ILLUS_LLM_PROVIDER: 'openai-api-key',
        ILLUS_OPENAI_API_KEY: 'sk-test-only',
      },
      { prompts: await promptRegistry() },
    )
    expect(server.mode).toBe('live')
  })

  it('loads every repository fixture through fileFixtures, without skipping invalid envelopes', async () => {
    const dir = resolveReaderFixturesDir({}, join(root, 'apps/reader'))
    const fixtures = await fileFixtures(dir)
    const roles = await readdir(dir, { withFileTypes: true })
    const keys = new Set<string>()
    for (const role of roles.filter((entry) => entry.isDirectory())) {
      for (const file of (await readdir(join(dir, role.name))).filter((name) =>
        name.endsWith('.json'),
      )) {
        const fixture = Fixture.parse(
          JSON.parse(await readFile(join(dir, role.name, file), 'utf8')),
        )
        const key = await keyOfFixture(fixture)
        keys.add(key)
        expect(await fixtures.get(key), `${role.name}/${file}`).toEqual(fixture)
      }
    }
    expect(keys.size).toBeGreaterThan(0)
    expect(fixtures.size()).toBe(keys.size)
  })

  it('replays a repository fixture through the same server factory used by the reader API', async () => {
    const cwd = join(root, 'apps/reader')
    vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    const dataDir = await temporaryDirectory()
    const files = await readdir(join(root, 'fixtures/llm/html-fallback'))
    const fixture = Fixture.parse(
      JSON.parse(
        await readFile(
          join(
            root,
            'fixtures/llm/html-fallback',
            files.find((f) => f.endsWith('.json'))!,
          ),
          'utf8',
        ),
      ),
    )
    expect(fixture.prefix).toBeTypeOf('string')
    expect(fixture.body).toBeTypeOf('string')
    const noNetwork = vi.fn(() => {
      throw new Error('replay must never call the network')
    })
    const server = await createReaderIllusServer(
      { ...env, ILLUS_DATA_DIR: dataDir },
      { prompts: await promptRegistry(), fetch: noNetwork },
    )
    const result = await server.gateway.handle(
      {
        role: fixture.role,
        schemaName: fixture.schemaName,
        promptVersion: fixture.promptVersion,
        prefix: fixture.prefix,
        body: fixture.body,
        requestId: 'reader-disk-replay',
      },
      { session: true },
    )
    expect(result).toMatchObject({
      status: 200,
      body: { ok: true, data: fixture.data },
    })
    expect(noNetwork).not.toHaveBeenCalled()
  })
})
