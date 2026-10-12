// Node-only persistence (ADR 0055). The indirect builtin load keeps Next 12's webpack out of SQLite.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
} from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { seal, unseal } from './token-store.ts'
import type { StoredTokens } from './token-store.ts'

export type ReaderDb = DatabaseSync
const DAY = 86_400_000

export function openReaderDb(o: { dir: string } | { memory: true }): ReaderDb {
  let path = ':memory:'
  if ('dir' in o) {
    mkdirSync(o.dir, { recursive: true, mode: 0o700 })
    path = join(o.dir, 'reader.db')
    closeSync(openSync(path, 'a', 0o600))
  }
  const sqlite = process.getBuiltinModule('node:sqlite') as {
    DatabaseSync: typeof DatabaseSync
  }
  const db = new sqlite.DatabaseSync(path)
  try {
    db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000',
    )
    db.exec('BEGIN IMMEDIATE')
    const version = Number(
      db.prepare('PRAGMA user_version').get()!.user_version,
    )
    if (version > 1)
      throw new Error('reader.db was created by a newer reader version')
    if (version < 1)
      db.exec(`
      CREATE TABLE users (sub TEXT PRIMARY KEY, email TEXT, created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE chatgpt_tokens (sub TEXT PRIMARY KEY REFERENCES users(sub) ON DELETE CASCADE,
        sealed TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, sub TEXT NOT NULL REFERENCES users(sub) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER);
      CREATE INDEX sessions_sub ON sessions(sub);
      CREATE TABLE usage (id INTEGER PRIMARY KEY, sub TEXT NOT NULL, ts INTEGER NOT NULL,
        attempts INTEGER NOT NULL, row TEXT NOT NULL);
      CREATE INDEX usage_sub_ts ON usage(sub, ts);
      CREATE TABLE usage_pause (sub TEXT PRIMARY KEY, paused_until INTEGER NOT NULL);
      PRAGMA user_version=1;
    `)
    db.exec('COMMIT')
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK')
    db.close()
    throw e
  }
  const cleanup = () => {
    if (!db.isOpen) return
    const now = Date.now()
    db.prepare(
      'DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?',
    ).run(now - 7 * DAY, now - 7 * DAY)
    db.prepare('DELETE FROM usage WHERE ts < ?').run(now - 90 * DAY)
  }
  cleanup()
  // In-memory databases are short-lived test instances; no housekeeping timer needed.
  if ('dir' in o) {
    const timer = setInterval(() => {
      if (!db.isOpen) return clearInterval(timer)
      try {
        cleanup()
      } catch {
        /* A transient busy database can wait until the next sweep. */
      }
    }, 3_600_000)
    timer.unref()
  }
  return db
}

/** Import each legacy file once. Mark the import in SQLite before renaming, so a crash cannot duplicate usage. */
export function migrateLegacyFiles(
  db: ReaderDb,
  o: { dir: string; key: Buffer; ownerSub?: string; now: () => number },
): void {
  const tokenFile = join(o.dir, 'chatgpt-tokens.enc')
  const usageFile = join(o.dir, 'usage.jsonl')
  if (!existsSync(tokenFile) && !existsSync(usageFile)) return
  // This table also makes a retry safe if the transaction committed but the rename failed.
  db.exec(
    'CREATE TABLE IF NOT EXISTS legacy_imports (file TEXT PRIMARY KEY, sub TEXT)',
  )
  const imported = (file: string) =>
    db.prepare('SELECT sub FROM legacy_imports WHERE file=?').get(file)
  let sub = imported('chatgpt-tokens.enc')?.sub as string | undefined
  const renamed: string[] = []
  db.exec('BEGIN IMMEDIATE')
  try {
    if (existsSync(tokenFile)) {
      if (!imported('chatgpt-tokens.enc')) {
        const t = JSON.parse(
          unseal(
            o.key,
            readFileSync(tokenFile, 'utf8').trim(),
            'illus:chatgpt-tokens:v1',
          ),
        ) as StoredTokens
        if (!t.sub || typeof t.sub !== 'string')
          throw new Error('legacy tokens have no account identity')
        sub = t.sub
        db.prepare(
          'INSERT INTO users(sub,email,created_at,last_seen_at) VALUES(?,?,?,?) ON CONFLICT(sub) DO NOTHING',
        ).run(sub, t.email ?? null, o.now(), o.now())
        db.prepare(
          'INSERT INTO chatgpt_tokens(sub,sealed,updated_at) VALUES(?,?,?) ON CONFLICT(sub) DO NOTHING',
        ).run(
          sub,
          seal(o.key, JSON.stringify(t), `illus:chatgpt-tokens:v2:${sub}`),
          o.now(),
        )
        db.prepare('INSERT INTO legacy_imports(file,sub) VALUES(?,?)').run(
          'chatgpt-tokens.enc',
          sub,
        )
      }
      renamed.push(tokenFile)
    }
    sub ??= o.ownerSub
    if (existsSync(usageFile) && sub) {
      if (!imported('usage.jsonl')) {
        const insert = db.prepare(
          'INSERT INTO usage(sub,ts,attempts,row) VALUES(?,?,?,?)',
        )
        for (const line of readFileSync(usageFile, 'utf8').split('\n')) {
          let row: Record<string, unknown>
          try {
            row = JSON.parse(line) as Record<string, unknown>
          } catch {
            continue
          }
          if (
            !row ||
            typeof row.ts !== 'number' ||
            row.ts <= o.now() - DAY ||
            typeof row.attempts !== 'number' ||
            !Number.isSafeInteger(row.attempts) ||
            row.attempts < 0
          )
            continue
          insert.run(sub, row.ts, row.attempts, JSON.stringify({ ...row, sub }))
        }
        db.prepare('INSERT INTO legacy_imports(file,sub) VALUES(?,?)').run(
          'usage.jsonl',
          sub,
        )
      }
      renamed.push(usageFile)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  for (const file of renamed) renameSync(file, `${file}.migrated`)
  if (renamed.length)
    console.info(
      'Reader: migrated legacy authentication/usage files to reader.db',
    )
}
