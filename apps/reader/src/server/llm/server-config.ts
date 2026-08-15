import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { llmModeFrom } from '@illus/llm'
import { createIllusServer } from '@illus/llm/server'
import type { IllusServer, IllusServerOptions } from '@illus/llm/server'

/** Keep repository layout knowledge in the app, not in the reusable LLM package. */
export function resolveReaderFixturesDir(
  env: Record<string, string | undefined>,
  cwd = process.cwd(),
): string {
  if (env.ILLUS_FIXTURES_DIR !== undefined) return env.ILLUS_FIXTURES_DIR
  let dir = resolve(cwd)
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml')))
      return join(dir, 'fixtures', 'llm')
    const parent = dirname(dir)
    if (parent === dir)
      throw new Error(
        `Cannot locate the reader workspace from ${cwd}; set ILLUS_FIXTURES_DIR for replay or record mode`,
      )
    dir = parent
  }
}

/** Shared by the route singleton and tests; live mode never needs the fixture tree. */
export async function createReaderIllusServer(
  env: Record<string, string | undefined>,
  options: IllusServerOptions,
): Promise<IllusServer> {
  if (llmModeFrom(env.ILLUS_LLM_MODE) === 'live' || options.fixtures)
    return createIllusServer(env, options)
  return createIllusServer(
    { ...env, ILLUS_FIXTURES_DIR: resolveReaderFixturesDir(env) },
    options,
  )
}
