# Setting up Sign in with ChatGPT

Each visitor signs in with their own ChatGPT account and model calls use that account's plan. Tokens stay encrypted on the server. No API key is required for the default `chatgpt-plan` provider; it never switches automatically to paid API billing. [ADR 0055](adr/0055-multi-user-chatgpt-signin.md) supersedes the single-account setup.

Upgrading an existing installation invalidates old session cookies once. Keep the existing encryption key: the server imports legacy tokens and recent usage into SQLite automatically.

## Run locally

Use Node 24 and the pinned pnpm version. Generate the two local secrets:

```sh
openssl rand -base64 32
openssl rand -base64 48
cp apps/reader/.env.local.example apps/reader/.env.local
```

Put the first value in `ILLUS_TOKEN_ENC_KEY` and the second in `ILLUS_SESSION_SECRET` in the ignored `.env.local`. Set:

```dotenv
ILLUS_LLM_MODE=live
ILLUS_PUBLIC_URL=http://127.0.0.1:7127
ILLUS_ACCESS=open
ILLUS_DATA_DIR=./.illus-data
```

The data directory is relative to the reader process working directory. An absolute private path outside the repository also works. Then:

```sh
pnpm i
pnpm dev
```

Open **http://127.0.0.1:7127/login**, choose **Continue with ChatGPT**, and grant plan usage. Open mode redirects directly to the reader after consent, with no owner configuration or restart. Use the exact host you configured; cookies differ between `localhost` and `127.0.0.1`.

`/auth/chatgpt/status` shows `configured`, `signedIn`, `planUsage`, `sub`, `email` when available, and your usage. If `planUsage` is false, repeat consent and grant plan usage. The Illustrate settings show the signed-in account and request counts.

## Run remotely or with Docker

Follow [deploy.md](deploy.md). Docker generates secrets once and stores them privately in `/data/secrets.json`. Set `ILLUS_PUBLIC_URL` to your reader's actual URL and `ILLUS_LLM_MODE=live`.

For a remote URL, **Continue with ChatGPT** opens a form with a link to ChatGPT in another tab. That tab finishes at a `http://127.0.0.1:7199/auth/chatgpt/callback?…` address that cannot load; this is expected. Copy the whole address into the reader's form within ten minutes. State, nonce and PKCE still bind the pasted code to that browser's attempt. Do not share the callback URL.

## Restrict who can sign in

`ILLUS_ACCESS=open` accepts any ChatGPT account. Set `ILLUS_ALLOWED_EMAILS` to comma-separated exact addresses or domains, for example `you@example.com,@example.org`. Matching ignores case and requires `email_verified: true`; `@example.org` matches that exact email domain. A refused grant is revoked before storing any tokens. Policy changes affect future sign-ins; existing sessions can be revoked in the database or the user disabled.

`ILLUS_ACCESS=owner` restores single-owner behavior. Set `ILLUS_ALLOWED_ACCOUNT_ID` to a known account `sub`, or leave it empty to use the saved owner or claim the reader on first sign-in. In Docker, a newly claimed owner requires one restart so the entrypoint can expose the owner to Edge. The optional password form uses the known owner's account and requires `ILLUS_LOGIN_PASSWORD` of at least 16 characters.

## Configuration reference

| Variable                   | Behavior                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ILLUS_ACCESS`             | `open` by default; `owner` restores single-owner access. Invalid values fail startup.                                                 |
| `ILLUS_ALLOWED_EMAILS`     | Optional verified-email allowlist in open mode; trimmed, lower-cased comma list.                                                      |
| `ILLUS_ALLOWED_ACCOUNT_ID` | Owner-mode restriction and optional password identity. Falls back to saved `ownerSub`.                                                |
| `ILLUS_SOURCE_URL`         | Login page source link; default `https://github.com/sangleshubham/flow-ai`. Set it to the source of your deployed fork.               |
| `ILLUS_PUBLIC_URL`         | Reader URL, default `http://127.0.0.1:3000`. HTTPS adds Secure cookies; non-loopback uses paste sign-in. Dev normally uses port 7127. |
| `ILLUS_DATA_DIR`           | Private server directory; required outside replay. Replay defaults to the OS temporary directory's `illus-replay`.                    |
| `ILLUS_TOKEN_ENC_KEY`      | 32 bytes in base64 or hex, encrypting token records. Required for live plan usage; Docker generates it when absent.                   |
| `ILLUS_SESSION_SECRET`     | At least 32 characters for cookie signatures. Changing it signs everyone out. Docker generates it when absent.                        |
| `ILLUS_LOGIN_PASSWORD`     | Optional password for the known owner's app session; minimum 16 characters.                                                           |
| `ILLUS_LLM_MODE`           | `replay` (default, no upstream calls), `live`, or `record` (live calls plus fixtures).                                                |
| `ILLUS_FIXTURES_DIR`       | Replay/record fixtures. Compose sets `/fixtures/llm` read-only; recording needs a writable directory such as `/data/fixtures/llm`.    |
| `ILLUS_MODELS_JSON`        | Optional model routing/effort overrides; only `low`, `medium`, `high` efforts are accepted.                                           |
| `ILLUS_LLM_PROVIDER`       | `chatgpt-plan` by default; `openai-api-key` explicitly opts into shared paid API credentials.                                         |
| `ILLUS_OPENAI_API_KEY`     | Required only for explicitly selecting `openai-api-key`; never an automatic fallback.                                                 |
| `ILLUS_CHATGPT_CLIENT_ID`  | Optional owner-mode client override. Open mode registers new accounts dynamically and reuses the client saved with each token set.    |
| `ILLUS_CHATGPT_ISSUER`     | Test-only issuer override; leave unset in deployment.                                                                                 |
| `ILLUS_AUTH_GATE`          | `off` skips Edge redirects only under `next dev`; production ignores it. Node APIs still check sessions.                              |
| `ILLUS_EVAL_SUB`           | Account identity for manually running live evals or `verify-models.ts`; otherwise the known owner is used.                            |

`ILLUS_MAX_REQUESTS_5H` and `ILLUS_MAX_REQUESTS_DAY` are ignored, with a startup warning. There are no local usage caps or `/api/llm` rate limits. Sign-in brute-force limits still apply.

## Storage, renewal and sign-out

`reader.db` stores users, encrypted per-account tokens, revocable sessions, usage and plan-limit pauses. The database file is created with mode 0600. `chatgpt-registration.json` holds the shared host ID and legacy owner registration. See [authentication_plan.md](../authentication_plan.md) for schema and migration details. Preserve the encryption key and protect the whole data volume, including generated secrets and any legacy `.migrated` backups.

Access tokens refresh automatically within five minutes of expiry, using that account's own issued client ID. A per-account lock prevents concurrent requests from reusing rotating refresh tokens. Terminal refresh errors remove only that account's credentials and ask it to sign in again; transient errors keep the credentials.

Settings **Sign out** revokes the current browser session. Other active sessions for that account continue working. Closing the last session through this action also revokes and deletes that account's stored tokens. Other accounts are unaffected. `DELETE /api/login` signs out of the app without revoking the ChatGPT grant.

## Usage and verification

`/api/llm/usage` returns only the signed-in user's `{ used5h, usedDay, pausedUntil }`. Counts include upstream attempts, retries and fallbacks. When OpenAI reports a plan-limit 429, only that user pauses until the supplied reset time, or 30 minutes if none is supplied. Cached reading and illustrations remain available.

For automated verification use `pnpm turbo run lint typecheck test` and `pnpm e2e` in replay mode. Live provider checks must be run manually:

```sh
ILLUS_EVAL_SUB=your-signed-in-sub node --env-file=apps/reader/.env.local packages/illus-llm/scripts/verify-models.ts
```

This command makes real model calls. Open two separate browser profiles and sign in as accounts A and B to verify separate identities and counts, sign out A and verify B still works, then check email restrictions and owner mode. Browser IndexedDB is shared by accounts using the same browser profile; use separate profiles for separate local libraries.

Record mode writes model answers with verbatim book evidence. Record only open-licensed fixture books if the output will be committed. Use a writable `ILLUS_FIXTURES_DIR`, then switch back to replay/live after recording.

## Troubleshooting

| Symptom                                           | Action                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Loopback page does not load during remote sign-in | Expected: paste the full address into the reader's existing form.                              |
| State mismatch or expired attempt                 | Start again in one tab and finish within ten minutes.                                          |
| Account not allowed                               | Check owner mode, allowlist spelling and whether the email is verified.                        |
| `signin-required`                                 | Reconnect that ChatGPT account and grant plan usage.                                           |
| `plan-limit`                                      | Check that account's ChatGPT usage and wait until its reset time; no local caps can be raised. |
| API 401 after an upgrade or logout                | Sign in again; the session ID must have a live database row.                                   |
| `configured: false`                               | Check the server log for missing keys, session secret or invalid model configuration.          |
| SQLite not available                              | Use Node 24; this deployment needs `node:sqlite`.                                              |
