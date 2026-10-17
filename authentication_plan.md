# Multi-user Continue with ChatGPT — implementation

Implemented on 2026-10-17. Each visitor can sign in with their own ChatGPT account. The gateway selects that user's encrypted credentials, records that user's usage, and pauses only that user when OpenAI reports a plan limit. Open mode is the default; `ILLUS_ACCESS=owner` retains single-owner access.

Existing installations must sign in once after upgrading because session cookies now require a database session ID. Preserve `ILLUS_TOKEN_ENC_KEY` so legacy credentials can migrate. No live OAuth consent or inference calls were made during implementation; the real two-account deployment check below remains manual.

The spec changes are recorded in [ADR 0055](docs/adr/0055-multi-user-chatgpt-signin.md). Number 0054 was already used by the item-preview ADR. Setup instructions are in [setup-chatgpt-signin.md](docs/setup-chatgpt-signin.md); deployment and backup instructions are in [deploy.md](docs/deploy.md).

## Behavior

- `ILLUS_ACCESS=open`: anyone who can reach the reader can sign in. An optional verified-email allowlist restricts sign-in by exact address or exact `@domain`, ignoring case.
- `ILLUS_ACCESS=owner`: only the configured or claimed owner can sign in. Owner claiming and the Docker restart behavior remain available.
- Each account has its own encrypted tokens, refresh lock, sessions, usage records and plan-limit pause. Every Node route derives identity from a verified session, never from an LLM request body.
- The local five-hour/day caps and Edge `/api/llm` rate limit are removed. Counts remain visible without a maximum. Upstream attempts, including retries and fallbacks, are recorded.
- An upstream plan-limit response pauses only its account until the supplied reset time, or 30 minutes if none is supplied. The pause survives server restart. The gateway does not switch to paid billing automatically.
- Password login retains a global five-attempts-per-minute limit. Public ChatGPT start/paste/callback endpoints share ten attempts per minute per IP, including locale and API aliases.
- Books, indexes and visuals remain in browser IndexedDB. Server storage contains authentication and usage only.

## Server architecture

`packages/illus-llm/src/server/db.ts` opens `ILLUS_DATA_DIR/reader.db` using built-in `node:sqlite` and runs schema migrations transactionally. SQLite is loaded through `process.getBuiltinModule` with a type-only import, avoiding a Next 12 webpack resolution error. No npm package or native build was added. The repo, CI and Docker target Node 24; local Node 22.21 also runs the tests with an ExperimentalWarning.

The private directory is created with mode 0700. The main database is pre-created with mode 0600 before SQLite opens it. Pragmas are `journal_mode=WAL`, `foreign_keys=ON`, and `busy_timeout=5000`.

Schema version 1 (`PRAGMA user_version`) is:

```sql
CREATE TABLE users (
  sub TEXT PRIMARY KEY, email TEXT, created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE chatgpt_tokens (
  sub TEXT PRIMARY KEY REFERENCES users(sub) ON DELETE CASCADE,
  sealed TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  sub TEXT NOT NULL REFERENCES users(sub) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE INDEX sessions_sub ON sessions(sub);
CREATE TABLE usage (
  id INTEGER PRIMARY KEY, sub TEXT NOT NULL, ts INTEGER NOT NULL,
  attempts INTEGER NOT NULL, row TEXT NOT NULL
);
CREATE INDEX usage_sub_ts ON usage(sub, ts);
CREATE TABLE usage_pause (sub TEXT PRIMARY KEY, paused_until INTEGER NOT NULL);
```

A `legacy_imports(file TEXT PRIMARY KEY, sub TEXT)` table is created when legacy files are found. It records committed imports so retrying after a crash before the source-file rename cannot duplicate usage.

Tokens use AES-256-GCM with per-user AAD `illus:chatgpt-tokens:v2:<sub>`. Copying another account's sealed row fails decryption. Tokens are never placed in cookies or returned to the browser. A signed cookie contains `{ sid, sub, email?, exp }`, with a random 24-byte session ID, HttpOnly, SameSite=Lax, a 30-day lifetime and Secure on HTTPS.

On open and hourly, housekeeping deletes sessions expired or revoked more than seven days ago and usage older than 90 days. Registration remains in the non-secret `chatgpt-registration.json` file; Docker's generated keys remain in private `secrets.json`.

## Sign-in and renewal flows

### Continue with ChatGPT

1. `/login` links to `/auth/chatgpt/start`, carrying a safe local `next` path.
2. The server creates PKCE, state and nonce, and stores them with the client ID, redirect URI, expiry and return path in a sealed ten-minute pending cookie.
3. For an unknown visitor in open mode, it sends `client_id=dynamic_agent_client` and the reader's name. The issued client ID is stored only with that user's encrypted tokens. A returning authenticated user reuses their own saved client ID and optional ID-token hint. Owner mode retains the shared registration client ID.
4. The callback verifies pending state, PKCE and the ID token, then checks owner/email policy. Rejected grants are revoked without saving tokens. Accepted credentials upsert only their account's rows.
5. The reader creates a database session and redirects to the safe return path. Open mode needs no owner claim or restart.

This differs from the original shared-client proposal: current [OpenAI registration guidance](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) says new accounts use dynamic registration and issued clients remain bound to their registered workspace. The implementation uses the plan's per-account fallback directly, without relying on an unperformed live shared-client spike. The shared host ID remains in the registration file.

### Remote paste sign-in

When `ILLUS_PUBLIC_URL` is not a loopback URL, the reader displays instructions explaining that calls use the visitor's own plan and tokens are encrypted on the server. ChatGPT opens in another tab and redirects to `http://127.0.0.1:7199/auth/chatgpt/callback`. That page cannot load, which is expected. The visitor pastes the complete address into the original reader form within ten minutes. The same pending cookie, state, nonce and PKCE validate the exchange.

### Credentials and refresh

The verified session `sub` reaches `gateway.handle(raw, { sub, signal })`, then `credential(sub)`. `getPlanToken(sub)` locks before loading the token row, so concurrent requests cannot refresh a stale copy after a sibling rotates it. It refreshes within five minutes of expiry using the client ID stored with that token set. Transient errors retain credentials; terminal refresh errors clear only the affected account. All inference calls retain explicit allowed reasoning effort.

### Sessions, password and logout

Node session verification checks the cookie signature, session ID, identity, expiration, a live unrevoked database session, and `users.disabled=0`. It updates last-seen at most once per minute per user. Owner mode also binds the configured owner.

Edge can check the signature and claims but cannot open SQLite. It enforces owner identity in owner mode and admits any properly signed identity with a session ID in open mode. A revoked session may load an HTML shell, but Node APIs reject it.

Password login obtains the known owner through `server.ownerSub()` and uses the same database sessions. The form is hidden until an owner is known. The container only copies a saved owner into `ILLUS_ALLOWED_ACCOUNT_ID` in owner mode.

Settings **Sign out** revokes the current session. If other sessions for that account are active, their credentials stay available. When this was the last session, the server revokes and deletes that account's tokens. Other users continue working. App-only `DELETE /api/login` revokes the session while retaining the ChatGPT grant. Signed-out or terminal-error accounts see **Continue with ChatGPT** again.

## Configuration

| Variable                   | Meaning                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ILLUS_ACCESS`             | `open` (default) or `owner`; other values fail startup.                                                                         |
| `ILLUS_ALLOWED_EMAILS`     | Optional comma-separated exact addresses or `@domain`s; normalized and requires verified email in open mode.                    |
| `ILLUS_ALLOWED_ACCOUNT_ID` | Owner-mode account and optional password identity; otherwise use saved `ownerSub`.                                              |
| `ILLUS_SOURCE_URL`         | HTTP(S) source link on login, default `https://github.com/sangleshubham/flow-ai`. Use the source for the deployed fork.         |
| `ILLUS_DATA_DIR`           | Private server directory; required outside replay. Replay defaults to the OS temporary directory's `illus-replay`.              |
| `ILLUS_TOKEN_ENC_KEY`      | 32-byte AES key, base64 or hex. Required for live ChatGPT plan usage; Docker generates/persists it when absent.                 |
| `ILLUS_SESSION_SECRET`     | At least 32 characters for cookie signatures; rotating it signs everyone out. Docker generates/persists it when absent.         |
| `ILLUS_PUBLIC_URL`         | Reader's actual URL; default `http://127.0.0.1:3000`. Controls Secure cookies and loopback/paste flow. Dev uses port 7127.      |
| `ILLUS_LOGIN_PASSWORD`     | Optional owner password, at least 16 characters.                                                                                |
| `ILLUS_LLM_MODE`           | `replay` (default, no model calls), `live`, or `record`.                                                                        |
| `ILLUS_FIXTURES_DIR`       | Replay/record fixture directory; Compose defaults to read-only `/fixtures/llm`. Use a private writable directory for recording. |
| `ILLUS_LLM_PROVIDER`       | `chatgpt-plan` (default) or explicit `openai-api-key`.                                                                          |
| `ILLUS_OPENAI_API_KEY`     | Required only for the explicit shared paid API-key provider; never an automatic fallback.                                       |
| `ILLUS_MODELS_JSON`        | Optional model/role/effort overrides; effort must be `low`, `medium`, or `high`.                                                |
| `ILLUS_CHATGPT_CLIENT_ID`  | Optional owner-mode override. Open mode uses the client ID issued for each user's token set.                                    |
| `ILLUS_CHATGPT_ISSUER`     | Test-only issuer override; deployment uses `https://auth.openai.com`.                                                           |
| `ILLUS_AUTH_GATE`          | `off` skips Edge gating in development only; Node session checks remain.                                                        |
| `ILLUS_EVAL_SUB`           | Account for manually running live evals/probes; otherwise use the known owner. Replay evals use an isolated synthetic identity. |

`ILLUS_MAX_REQUESTS_5H` and `ILLUS_MAX_REQUESTS_DAY` are no longer read as limits. Either being set produces one startup warning that it is ignored. No UI max fields remain. The constant `100` used by the index-cost estimator is only an unused display-share denominator; it does not enforce a cap.

## Automatic legacy migration

On server startup with a token encryption key:

1. Unseal `chatgpt-tokens.enc` with the old v1 AAD. Insert the user and re-encrypt tokens using the per-user v2 AAD without overwriting a newer token row.
2. Import valid `usage.jsonl` rows from the previous 24 hours under that token account, or the known owner if there is no token file. Torn/invalid lines are skipped. Usage without an identifiable account stays untouched until an owner is supplied.
3. Commit data and import markers in one transaction, then rename source files to `.migrated`. Failed decryption rolls back and retains the original source. Retrying a committed import does not duplicate data.
4. Legacy cookies without `sid` are rejected; users sign in again. Registration remains unchanged.

Keep the encryption key and protect `.migrated` files as credentials. To back up, use SQLite's online backup facility or stop the reader and copy the entire data volume, including any WAL files and keys. Copying only a running main database can omit recent writes.

## Verification

Automated verification uses replay mode, in-memory SQLite or temporary directories, and the fake OIDC/Responses providers. It covers:

- Schema idempotence, private permissions, crash-safe legacy import, owner-only usage migration, rollback, per-user AAD, and retention cleanup.
- Two accounts signing in, isolated tokens/refresh/logout, five simultaneous credential requests causing one refresh, and terminal errors preserving the other account.
- Exact/domain email allowlists, case handling, unverified-email refusal and grant revocation; owner-mode regression coverage.
- Revoked, expired, disabled and legacy sessions; active-device counts and hardened cookie attributes.
- User identity passed to credentials and usage, 500 successful upstream attempts without local caps, isolated/persistent plan pauses, and rolling usage windows.
- Open-mode Edge acceptance followed by Node rejection without a session row, no local 429 across 70 rapid requests, password login, sign-in throttling, safe return paths, and route status/logout account isolation.
- Existing reader, EPUB, illustration, animation, tracer and CSP behavior.

Completed checks:

```sh
pnpm turbo run lint typecheck test --concurrency=3 --continue
pnpm --filter @flow/reader e2e
pnpm e2e --concurrency=1 --continue
```

The full gate passed all 43 tasks, including 147 LLM tests and 175 reader tests. The production reader replay browser suite passed all 16 tests. The broader `pnpm e2e --concurrency=1 --continue` passed the reader, animation (27 tests), tracer and book-index suites. The renderer core suite passed 36 tests and failed 30 because the checkout has no Linux screenshot baselines; its later suites were not reached. A parallel attempt had also hit a reduced-motion animation failure, which passed in isolation. No renderer/animation code or approved snapshots were changed, and the automatically generated missing-baseline files were removed. `git diff --check` is clean. The working environment uses Node 22.21.1; CI and Docker remain on Node 24. No live evals were run.

### Manual two-account deployment check

1. Run `docker compose up --build` with `ILLUS_ACCESS=open`, the correct public URL and live mode. Check the migration log if upgrading and confirm `/data/reader.db` exists.
2. Sign in as A and B in separate browser profiles. Generate a section in each. Check distinct identities and independent counts at `/auth/chatgpt/status`.
3. Sign out A; its API calls should return 401 while B keeps working. For one account on two devices, signing out one must preserve the other device.
4. Restart with only A's email allowed; B's next sign-in is refused while A succeeds. Then test `ILLUS_ACCESS=owner`.
5. Confirm provider consent and that model calls draw on the intended account's plan. Automated fake-provider tests cannot establish real account eligibility or billing.

## Known limits

- One Node process/container: refresh locks and sign-in buckets are in memory. Multiple replicas need shared locking.
- Browser profiles share IndexedDB across account switches. Use separate profiles for separate local libraries.
- No reader-side model-usage ceiling; multiple tabs/devices can consume their own plan quickly.
- Edge cannot see revocation or user disabling; Node enforces both.
- Allowlist changes apply to new sign-ins. Revoke existing sessions or disable a user to remove current access.
- This change preserves the deployment boundary and Next 12 constraints documented in ADR 0005; it does not change hosting exposure.
