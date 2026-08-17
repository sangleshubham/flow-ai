// Test/generator utility: profiles share role directories but may replace only their own artifacts.
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Fixture } from '@illus/llm'

export const COMPLETE_NOTE_END = 'Written from packages/illus-pipeline/test/fixtures/synthetic-calls.ts.'
export const isCompleteFixture = (f: Fixture) => f.source === 'handwritten' && !!f.note?.startsWith('synthetic.epub:') && f.note.endsWith(COMPLETE_NOTE_END)
export const isBrowserFixture = (f: Fixture) => f.source === 'handwritten' && !!f.note?.startsWith('synthetic.epub browser:')

/** Preflight every collision before changing files; an unrelated profile is never overwritten. */
export function writeFixtureProfile(directory: string, roles: readonly string[], written: readonly Fixture[], owns: (fixture: Fixture) => boolean): void {
  const replacements = written.map((f) => Fixture.parse(f))
  const deletions: string[] = []
  const preserved = new Set<string>()
  for (const f of replacements) {
    if (!f.key || !roles.includes(f.role) || !owns(f)) throw new Error('generated fixture does not belong to this profile')
  }
  for (const role of roles) {
    const roleDirectory = join(directory, role)
    let files: string[]
    try { files = readdirSync(roleDirectory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const file of files) {
      if (!/^[0-9a-f]{64}\.json$/.test(file)) continue
      const path = join(roleDirectory, file)
      const existing = Fixture.parse(JSON.parse(readFileSync(path, 'utf8')))
      if (owns(existing)) deletions.push(path)
      else {
        const replacement = replacements.find((f) => f.role === role && `${f.key}.json` === file)
        if (!replacement) continue
        const { note: _oldNote, ...oldPayload } = existing
        const { note: _newNote, ...newPayload } = replacement
        if (JSON.stringify(oldPayload) !== JSON.stringify(newPayload)) throw new Error(`fixture key collision with another profile: ${path}`)
        preserved.add(path)
      }
    }
  }
  for (const path of deletions) unlinkSync(path)
  for (const fixture of replacements) {
    const path = join(directory, fixture.role, `${fixture.key}.json`)
    if (preserved.has(path)) continue
    mkdirSync(join(directory, fixture.role), { recursive: true })
    writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`)
  }
}
