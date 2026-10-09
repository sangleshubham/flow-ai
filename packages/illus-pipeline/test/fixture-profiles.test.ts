import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Fixture } from '@illus/llm'
import { describe, expect, test } from 'vitest'

import { COMPLETE_NOTE_END, isCompleteFixture, writeFixtureProfile } from './fixtures/profile-writer.ts'

const fixture = (key: string, note: string): Fixture => ({ key: key.repeat(64), source: 'handwritten', role: 'planner', promptVersion: '1.0.0', model: 'gpt-6.1-sol', effort: 'medium', schemaName: 'VisualPlan', data: {}, note })
const complete = (key: string) => fixture(key, `synthetic.epub: planner. ${COMPLETE_NOTE_END}`)

describe('fixture profile regeneration', () => {
  test('replaces only its own artifacts and preserves browser/other fixtures byte for byte', () => {
    const root = mkdtempSync(join(tmpdir(), 'illus-fixture-profile-'))
    try {
      writeFixtureProfile(root, ['planner'], [complete('1')], isCompleteFixture)
      const browser = fixture('2', 'synthetic.epub browser: fresh preface')
      const browserPath = join(root, 'planner', `${browser.key}.json`)
      const bytes = JSON.stringify(browser)
      writeFileSync(browserPath, bytes)
      writeFileSync(join(root, 'planner', 'other.json'), '{"other":"asset"}')
      writeFixtureProfile(root, ['planner'], [complete('3')], isCompleteFixture)
      expect(readFileSync(browserPath, 'utf8')).toBe(bytes)
      expect(readdirSync(join(root, 'planner')).sort()).toEqual([`${browser.key}.json`, `${'3'.repeat(64)}.json`, 'other.json'].sort())
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('a conflicting key fails before deleting old outputs or overwriting another profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'illus-fixture-profile-'))
    try {
      writeFixtureProfile(root, ['planner'], [complete('1')], isCompleteFixture)
      const browser = fixture('2', 'synthetic.epub browser: fresh preface')
      const browserPath = join(root, 'planner', `${browser.key}.json`)
      const bytes = JSON.stringify(browser)
      writeFileSync(browserPath, bytes)
      expect(() => writeFixtureProfile(root, ['planner'], [{ ...complete('2'), data: { conflict: true } }], isCompleteFixture)).toThrow(/key collision/)
      expect(readFileSync(browserPath, 'utf8')).toBe(bytes)
      expect(readdirSync(join(root, 'planner'))).toContain(`${'1'.repeat(64)}.json`)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
