import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it } from 'vitest'

import {
  createTokenStore,
  migrateLegacyFiles,
  openReaderDb,
  seal,
} from '../src/server/index.ts'
import type { StoredTokens } from '../src/server/index.ts'

const key = Buffer.alloc(32, 7)
const tokens: StoredTokens = {
  issuer: 'https://auth.test',
  sub: 'A',
  email: 'a@example.com',
  clientId: 'client',
  hostId: 'host',
  accessToken: 'secret',
  refreshToken: 'refresh',
  tokenType: 'bearer',
  expiresAt: 100,
  scope: '',
  savedAt: 100,
}

it('opens and migrates the database repeatedly with owner-only permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reader-db-'))
  for (let i = 0; i < 2; i++) {
    const db = openReaderDb({ dir })
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    db.close()
  }
  expect(statSync(join(dir, 'reader.db')).mode & 0o777).toBe(0o600)
})

it('imports legacy tokens and recent usage once, then renames the source files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reader-legacy-'))
  writeFileSync(
    join(dir, 'chatgpt-tokens.enc'),
    seal(key, JSON.stringify(tokens), 'illus:chatgpt-tokens:v1'),
  )
  writeFileSync(
    join(dir, 'usage.jsonl'),
    [
      JSON.stringify({ ts: 100, attempts: 2 }),
      'torn',
      JSON.stringify({ ts: -100_000_000, attempts: 3 }),
    ].join('\n'),
  )
  const db = openReaderDb({ dir })
  migrateLegacyFiles(db, { dir, key, now: () => 200 })
  migrateLegacyFiles(db, { dir, key, now: () => 200 })
  expect(await createTokenStore({ db, dir, key }).loadTokens('A')).toEqual(
    tokens,
  )
  expect(db.prepare('SELECT sub, attempts FROM usage').all()).toEqual([
    { sub: 'A', attempts: 2 },
  ])
  expect(
    readFileSync(join(dir, 'chatgpt-tokens.enc.migrated'), 'utf8'),
  ).toBeTruthy()
  expect(readFileSync(join(dir, 'usage.jsonl.migrated'), 'utf8')).toContain(
    'torn',
  )
  db.close()
})

it('binds encrypted rows to their user and clears only that user', async () => {
  const db = openReaderDb({ memory: true })
  const store = createTokenStore({ db, dir: tmpdir(), key })
  await store.saveTokens(tokens)
  await store.saveTokens({ ...tokens, sub: 'B' })
  db.prepare(
    'UPDATE chatgpt_tokens SET sealed=(SELECT sealed FROM chatgpt_tokens WHERE sub=?) WHERE sub=?',
  ).run('A', 'B')
  await expect(store.loadTokens('B')).rejects.toThrow()
  await store.clearTokens('B')
  expect(await store.loadTokens('A')).toEqual(tokens)
  db.close()
})

it('does not duplicate an import if the files reappear after a committed migration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reader-retry-'))
  const legacy = seal(key, JSON.stringify(tokens), 'illus:chatgpt-tokens:v1')
  const usage = JSON.stringify({ ts: 100, attempts: 2 })
  const db = openReaderDb({ dir })
  const migrate = () => migrateLegacyFiles(db, { dir, key, now: () => 200 })
  writeFileSync(join(dir, 'chatgpt-tokens.enc'), legacy)
  writeFileSync(join(dir, 'usage.jsonl'), usage)
  migrate()
  writeFileSync(join(dir, 'chatgpt-tokens.enc'), legacy)
  writeFileSync(join(dir, 'usage.jsonl'), usage)
  migrate()
  expect(db.prepare('SELECT COUNT(*) AS n FROM usage').get()!.n).toBe(1)
  db.close()
})

it('migrates usage without tokens for the configured owner, keeping unknown usage unassigned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reader-owner-'))
  writeFileSync(
    join(dir, 'usage.jsonl'),
    JSON.stringify({ ts: 100, attempts: 2 }),
  )
  const db = openReaderDb({ dir })
  migrateLegacyFiles(db, { dir, key, now: () => 200 })
  expect(db.prepare('SELECT COUNT(*) AS n FROM usage').get()!.n).toBe(0)
  migrateLegacyFiles(db, { dir, key, ownerSub: 'owner', now: () => 200 })
  expect(db.prepare('SELECT sub FROM usage').all()).toEqual([{ sub: 'owner' }])
  db.close()
})

it('rolls back an invalid encrypted import and preserves the original file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reader-invalid-'))
  writeFileSync(join(dir, 'chatgpt-tokens.enc'), 'tampered')
  const db = openReaderDb({ dir })
  expect(() => migrateLegacyFiles(db, { dir, key, now: () => 200 })).toThrow()
  expect(readFileSync(join(dir, 'chatgpt-tokens.enc'), 'utf8')).toBe('tampered')
  expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()!.n).toBe(0)
  db.close()
})

it('prunes old sessions and usage when reopening the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reader-cleanup-'))
  const now = Date.now()
  let db = openReaderDb({ dir })
  db.prepare(
    'INSERT INTO users(sub,created_at,last_seen_at) VALUES(?,?,?)',
  ).run('A', now, now)
  const session = db.prepare(
    'INSERT INTO sessions(id,sub,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?)',
  )
  session.run('expired', 'A', 0, now - 8 * 86_400_000, null)
  session.run('revoked', 'A', 0, now + 86_400_000, now - 8 * 86_400_000)
  session.run('live', 'A', now, now + 86_400_000, null)
  const usage = db.prepare(
    'INSERT INTO usage(sub,ts,attempts,row) VALUES(?,?,?,?)',
  )
  usage.run('A', now - 91 * 86_400_000, 1, '{}')
  usage.run('A', now, 1, '{}')
  db.close()
  db = openReaderDb({ dir })
  expect(db.prepare('SELECT id FROM sessions').all()).toEqual([{ id: 'live' }])
  expect(db.prepare('SELECT COUNT(*) AS n FROM usage').get()!.n).toBe(1)
  db.close()
})
