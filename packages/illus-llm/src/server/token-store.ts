// ChatGPT credentials at rest (§9 "Tokens", §17): AES-256-GCM under `ILLUS_TOKEN_ENC_KEY`, in
// `ILLUS_DATA_DIR`/reader.db, encrypted separately for each account. Tokens never leave the server.
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ReaderDb } from './db.ts'

/** Decodes `ILLUS_TOKEN_ENC_KEY`: 32 bytes as base64 (44 chars) or hex (64 chars). */
export function parseEncKey(value: string | undefined): Buffer {
  const v = value?.trim() ?? ''
  const key = /^[0-9a-fA-F]{64}$/.test(v)
    ? Buffer.from(v, 'hex')
    : Buffer.from(v, 'base64')
  if (key.length !== 32)
    throw new Error(
      'ILLUS_TOKEN_ENC_KEY must be 32 bytes, base64 or hex (e.g. `openssl rand -base64 32`)',
    )
  return key
}

/** AES-256-GCM. `aad` binds the ciphertext to its purpose (tokens vs. the pending-login cookie). */
export function seal(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url')
}

/** Throws when the data was tampered with, sealed for another purpose, or with another key. */
export function unseal(key: Buffer, sealed: string, aad: string): string {
  const buf = Buffer.from(sealed, 'base64url')
  if (buf.length < 29) throw new Error('sealed value is too short')
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([
    decipher.update(buf.subarray(28)),
    decipher.final(),
  ]).toString('utf8')
}

/** One signed-in ChatGPT account's credentials (OpenAI "Credential storage"). */
export interface StoredTokens {
  issuer: string
  sub: string
  email?: string
  clientId: string
  hostId: string
  idToken?: string
  accessToken: string
  refreshToken?: string
  tokenType: string
  /** Epoch ms. */
  expiresAt: number
  scope: string
  savedAt: number
}

/** Non-secret: the persistent host id, the client id issued at first registration and the owner. */
export interface Registration {
  hostId: string
  clientId?: string
  /** The account that claimed this reader at its first sign-in (ADR 0047). */
  ownerSub?: string
}

export interface TokenStore {
  loadTokens(sub: string): Promise<StoredTokens | undefined>
  saveTokens(t: StoredTokens): Promise<void>
  clearTokens(sub: string): Promise<void>
  /** Creates and persists a host id (`urn:uuid:…`) on first use. */
  loadRegistration(): Promise<Registration>
  saveRegistration(r: Registration): Promise<void>
}

const REGISTRATION_FILE = 'chatgpt-registration.json'

export function createTokenStore(o: {
  db: ReaderDb
  dir: string
  key: Buffer
}): TokenStore {
  const path = (f: string) => join(o.dir, f)
  const write = async (file: string, data: string) => {
    await mkdir(o.dir, { recursive: true, mode: 0o700 })
    const tmp = path(`${file}.${process.pid}.${randomUUID()}.tmp`)
    await writeFile(tmp, data, { mode: 0o600 })
    await rename(tmp, path(file))
  }
  const read = async (file: string) => {
    try {
      return await readFile(path(file), 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw e
    }
  }
  return {
    async loadTokens(sub) {
      const row = o.db
        .prepare('SELECT sealed FROM chatgpt_tokens WHERE sub=?')
        .get(sub)
      if (!row) return undefined
      const t = JSON.parse(
        unseal(o.key, String(row.sealed), `illus:chatgpt-tokens:v2:${sub}`),
      ) as StoredTokens
      if (t.sub !== sub) throw new Error('token account mismatch')
      return t
    },
    async saveTokens(t) {
      o.db.exec('BEGIN IMMEDIATE')
      try {
        o.db
          .prepare(
            `INSERT INTO users(sub,email,created_at,last_seen_at) VALUES(?,?,?,?)
          ON CONFLICT(sub) DO UPDATE SET email=excluded.email,last_seen_at=excluded.last_seen_at`,
          )
          .run(t.sub, t.email ?? null, t.savedAt, t.savedAt)
        o.db
          .prepare(
            `INSERT INTO chatgpt_tokens(sub,sealed,updated_at) VALUES(?,?,?)
          ON CONFLICT(sub) DO UPDATE SET sealed=excluded.sealed,updated_at=excluded.updated_at`,
          )
          .run(
            t.sub,
            seal(o.key, JSON.stringify(t), `illus:chatgpt-tokens:v2:${t.sub}`),
            t.savedAt,
          )
        o.db.exec('COMMIT')
      } catch (e) {
        o.db.exec('ROLLBACK')
        throw e
      }
    },
    async clearTokens(sub) {
      o.db.prepare('DELETE FROM chatgpt_tokens WHERE sub=?').run(sub)
    },
    async loadRegistration() {
      const raw = await read(REGISTRATION_FILE)
      if (raw) return JSON.parse(raw) as Registration
      const r: Registration = { hostId: `urn:uuid:${randomUUID()}` }
      await write(REGISTRATION_FILE, JSON.stringify(r, null, 2))
      return r
    },
    saveRegistration: (r) =>
      write(REGISTRATION_FILE, JSON.stringify(r, null, 2)),
  }
}
