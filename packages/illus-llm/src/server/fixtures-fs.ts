// `fixtures/llm/<role>/<key>.json` on disk (Node only): read for replay, written in record mode.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Fixture, keyOfFixture } from '../fixtures.ts'
import type { FixtureStore } from '../fixtures.ts'

/** Loads every fixture under `dir` once; invalid files throw with their path so they get fixed. */
export async function fileFixtures(dir: string): Promise<FixtureStore & { size(): number }> {
  const map = new Map<string, Fixture>()
  let roles: string[] = []
  try {
    roles = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  for (const role of roles) {
    for (const file of await readdir(join(dir, role))) {
      if (!file.endsWith('.json')) continue
      const path = join(dir, role, file)
      const parsed = Fixture.safeParse(JSON.parse(await readFile(path, 'utf8')))
      if (!parsed.success) throw new Error(`invalid LLM fixture ${path}: ${parsed.error.message}`)
      map.set(await keyOfFixture(parsed.data), parsed.data)
    }
  }
  return {
    get: async (key) => map.get(key),
    async put(f) {
      await mkdir(join(dir, f.role), { recursive: true })
      await writeFile(join(dir, f.role, `${f.key}.json`), JSON.stringify(f, null, 2) + '\n')
      map.set(f.key, f)
    },
    size: () => map.size,
  }
}
