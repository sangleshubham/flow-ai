// Container entrypoint (ADR 0047). Fills in the configuration a self-hosted reader can work out for itself,
// then starts the Next standalone server. Values already in the environment always win.
// - ILLUS_TOKEN_ENC_KEY and ILLUS_SESSION_SECRET: generated once and kept in ILLUS_DATA_DIR/secrets.json
//   (owner-only). The first run copies any values given in the environment, so they can be removed later.
// - ILLUS_ALLOWED_ACCOUNT_ID: the owner saved in chatgpt-registration.json by the first ChatGPT sign-in.
//   It is read here because the Edge middleware sees only environment variables, not files.
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const env = process.env
const set = (name) => !!env[name]?.trim()
const dataDir = env.ILLUS_DATA_DIR?.trim() || '/data'

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return undefined
    throw new Error(`cannot read ${file}: ${e.message}`)
  }
}

const secretsFile = join(dataDir, 'secrets.json')
let secrets = readJson(secretsFile)
if (!secrets) {
  secrets = {
    ILLUS_TOKEN_ENC_KEY: set('ILLUS_TOKEN_ENC_KEY') ? env.ILLUS_TOKEN_ENC_KEY.trim() : randomBytes(32).toString('base64'),
    ILLUS_SESSION_SECRET: set('ILLUS_SESSION_SECRET') ? env.ILLUS_SESSION_SECRET : randomBytes(48).toString('base64'),
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const tmp = `${secretsFile}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, secretsFile)
  console.log(`Saved the reader's secrets to ${secretsFile}`)
}
for (const name of ['ILLUS_TOKEN_ENC_KEY', 'ILLUS_SESSION_SECRET'])
  if (!set(name) && secrets[name]) env[name] = secrets[name]

const owner = readJson(join(dataDir, 'chatgpt-registration.json'))?.ownerSub
if (env.ILLUS_ACCESS === 'owner' && !set('ILLUS_ALLOWED_ACCOUNT_ID') && typeof owner === 'string' && owner) env.ILLUS_ALLOWED_ACCOUNT_ID = owner

await import(new URL('./server.js', import.meta.url).href)
