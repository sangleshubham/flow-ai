# Setting up Sign in with ChatGPT

How to connect the reader to your ChatGPT Plus plan (spec §9, §15, §17). You do this once per machine. It takes about 15 minutes. Background and the reasons behind each step are in [ADR 0007](adr/0007-w2-gateway-and-signin-decisions.md).

What you get: the Next.js server holds your ChatGPT tokens, encrypted, and calls the Responses API for the reader. The browser never sees a token. Calls use your Plus allowance. Nothing ever switches to paid API billing on its own.

## Before you start

- A ChatGPT Plus account.
- Node 24 and `pnpm i` done in the repo.
- Use **`127.0.0.1`**, not `localhost`, everywhere below. OpenAI only accepts a loopback redirect on `127.0.0.1`, and cookies are per host name.
- `pnpm dev` serves on port **7127**. `next start` and Docker serve on port 3000. The examples use 7127. Use whichever port you actually run.

## 1. Generate the two secrets

```sh
openssl rand -base64 32   # → ILLUS_TOKEN_ENC_KEY (exactly 32 bytes; encrypts your tokens at rest)
openssl rand -base64 48   # → ILLUS_SESSION_SECRET (signs the reader's session cookie)
```

Keep both somewhere safe, such as a password manager. If you lose `ILLUS_TOKEN_ENC_KEY`, the stored tokens can't be decrypted and you sign in again. If you change `ILLUS_SESSION_SECRET`, every session ends.

## 2. Create `apps/reader/.env.local`

This file is git-ignored. Never commit it.

```sh
# Mode: replay (default, fixtures only) | live | record. Live calls use your plan.
ILLUS_LLM_MODE=live

# Where the OAuth callback lands. It must be http://127.0.0.1:<port>. No trailing slash.
ILLUS_PUBLIC_URL=http://127.0.0.1:7127

# Leave this empty for the first sign-in. Step 4 tells you the value.
ILLUS_ALLOWED_ACCOUNT_ID=

ILLUS_TOKEN_ENC_KEY=<from step 1>
ILLUS_SESSION_SECRET=<from step 1>

# Token store and usage log. Use an absolute path outside the repo (a Docker volume on a server).
ILLUS_DATA_DIR=/Users/<you>/.illus-data

# Local soft caps that protect the five-hour window you share with other apps. These are the starting values.
ILLUS_MAX_REQUESTS_5H=100
ILLUS_MAX_REQUESTS_DAY=300

# Optional. Unset means the §9 default model table (tiers, efforts, allowlist).
# ILLUS_MODELS_JSON={"roleOverrides":{"critic":{"models":[{"model":"gpt-6-astra","effort":"low"}]}}}

# Optional. Leave both unset to use only your plan.
# ILLUS_LLM_PROVIDER=openai-api-key
# ILLUS_OPENAI_API_KEY=sk-...

# Optional override. Normally unset: the client id is issued at first sign-in and saved (step 3).
# ILLUS_CHATGPT_CLIENT_ID=oaiapp_...
```

Every variable:

| Variable | Required | Value |
| --- | --- | --- |
| `ILLUS_LLM_MODE` | no | `replay` (default), `live` or `record`. Use `live` for real use. Use `record` only to re-record fixtures. |
| `ILLUS_PUBLIC_URL` | yes, for sign-in | `http://127.0.0.1:<port>`. The callback is `${ILLUS_PUBLIC_URL}/auth/chatgpt/callback`. |
| `ILLUS_ALLOWED_ACCOUNT_ID` | yes, after step 4 | Your ChatGPT account id (the ID token `sub`). Every other account is refused. |
| `ILLUS_TOKEN_ENC_KEY` | yes | 32 bytes, base64 or hex (AES-256-GCM key for the token file). |
| `ILLUS_SESSION_SECRET` | yes | At least 32 characters (HMAC key for the session cookie). |
| `ILLUS_MAX_REQUESTS_5H` | no | Requests per rolling 5 hours. Default 100. |
| `ILLUS_MAX_REQUESTS_DAY` | no | Requests per rolling 24 hours. Default 300. |
| `ILLUS_DATA_DIR` | yes, outside replay | Directory for `chatgpt-tokens.enc`, `chatgpt-registration.json` and `usage.jsonl`. |
| `ILLUS_MODELS_JSON` | no | Tier → model mapping and role overrides. Keys you give replace the default's keys. Efforts outside `low`/`medium`/`high` are rejected at start-up. |
| `ILLUS_OPENAI_API_KEY` | no | Only with `ILLUS_LLM_PROVIDER=openai-api-key`. Paid API billing. Never used automatically. |
| `ILLUS_LLM_PROVIDER` | no | `chatgpt-plan` (default) or `openai-api-key`. |
| `ILLUS_CHATGPT_CLIENT_ID` | no | Overrides the saved issued client id. |
| `ILLUS_CHATGPT_ISSUER` | no | Tests only. Leave unset (`https://auth.openai.com`). |
| `ILLUS_FIXTURES_DIR` | no | Fixture directory for `replay` and `record`. Unset means `fixtures/llm` in the repo. Set it in Docker, where there is no repo. |

The login gate's own variables (`ILLUS_LOGIN_PASSWORD`, `ILLUS_AUTH_GATE`) are in [docs/deploy.md](deploy.md).

## 3. First sign-in, which also registers the client

The reader is an open-source client. There's no form to fill in: your first sign-in registers it with OpenAI ("dynamic registration"), and OpenAI issues a client id that starts with `oaiapp_`.

1. Start the app: `pnpm dev`.
2. Open **http://127.0.0.1:7127/auth/chatgpt/start**.
3. OpenAI shows the sign-in and consent screen for **AI Illustrated Reader**. Sign in with your Plus account and **allow ChatGPT plan usage**. That permission is the `chatgpt.tokens.use.direct` scope, and without it the reader can't make model calls.
4. You land on **"ILLUS_ALLOWED_ACCOUNT_ID is not set. Set it to `<id>`…"**. This is expected on the first run. The reader refuses every account until you name yours, and it has already revoked the tokens it just received. The issued client id is now saved in `ILLUS_DATA_DIR/chatgpt-registration.json` (not secret) together with this machine's host id.

## 4. Allow your account and sign in for real

1. Put the id from step 3.4 in `.env.local`: `ILLUS_ALLOWED_ACCOUNT_ID=<id>`.
2. Restart `pnpm dev`.
3. Open **http://127.0.0.1:7127/auth/chatgpt/start** again. This time the reader reuses the saved client id, and you are redirected to the reader, signed in.
4. Check the result at **http://127.0.0.1:7127/auth/chatgpt/status**. It should show `"configured": true`, `"signedIn": true`, `"planUsage": true`, your `sub`, and `clientId` starting with `oaiapp_`.
   - `"planUsage": false` means plan usage was not allowed on the consent screen. Sign in again and allow it.
5. `ILLUS_DATA_DIR` now holds `chatgpt-tokens.enc`, which is encrypted and readable only by you (mode 0600). Never copy it anywhere public.

The access token lasts an hour. The server refreshes it automatically when it has less than 5 minutes left. The refresh token is renewed each time and lasts 30 days. If it expires or is revoked, the pane shows "sign in with ChatGPT", and you repeat step 4.3.

To sign out and revoke the tokens, send `POST /auth/chatgpt/logout` from the signed-in browser. The reader's settings will get a button for this. You can also disconnect the app under ChatGPT settings, but OpenAI doesn't notify the reader when you do. The reader then answers `signin-required` on its next refresh.

## 5. Set a per-app cap in ChatGPT

Plan calls draw on three limits:

- your Plus weekly allowance;
- a per-app weekly cap that you set;
- a five-hour window shared by every connected app.

When any of them runs out, the reader pauses all model calls until the reset (or for 30 minutes when OpenAI gives no reset time). Cached visuals keep working.

1. In ChatGPT, open **Settings**, then the section that lists connected apps and their usage (OpenAI calls it **Usage**).
2. Select **AI Illustrated Reader** and set a weekly cap, for example a quarter of your allowance, so the reader can never use up your plan for other apps.
3. Keep the local soft caps (`ILLUS_MAX_REQUESTS_5H`, `ILLUS_MAX_REQUESTS_DAY`) below what you want the reader to use in five hours and in a day. The pane shows usage against them (`GET /api/llm/usage`).

## 6. Verify the models and the critic's image input (M0)

This step makes real calls on your plan: about two per model, 16 in total. Run it yourself, once, after step 4:

```sh
node --env-file=apps/reader/.env.local packages/illus-llm/scripts/verify-models.ts
```

For every allowlisted model, it prints whether the model is listed for your account, and whether a strict `text.format` call at `reasoning.effort: low` works. If `text.format` fails, it also tries the function-tool fallback. Last, it sends a 1×1 PNG to the critic's model.

What to do with the output:

- **A model that fails on both paths** is not available to your account. Remove it from the allowlist and the tiers in `ILLUS_MODELS_JSON`. The gateway already moves to the next model in the chain when a model is unavailable, but removing it saves a wasted request.
- **`text.format` fails but the tool fallback works**: nothing to do. The gateway switches to the tool by itself after the first rejection. Mention it to the build, because it affects latency.
- **The critic model rejects the image**: set
  `ILLUS_MODELS_JSON={"roleOverrides":{"critic":{"models":[{"model":"gpt-6-astra","effort":"low"}]}}}` (spec §9).
- Record what you found in the build log or an ADR. The M1 effort sweep starts from these results.

## 7. Re-recording fixtures (record mode)

`record` is `live` plus a saved fixture for every successful call. Use it when a role's prompt version changes and its replay fixtures no longer match (replay then says `no fixture for <role>`).

1. In `.env.local` set `ILLUS_LLM_MODE=record`, restart `pnpm dev`, and open an **open-licensed book from `fixtures/books/`**.
2. Generate the sections you need. Each answer is written to `fixtures/llm/<role>/<key>.json` (or `ILLUS_FIXTURES_DIR`). The key is the SHA-256 of `{role, promptVersion, model, prefix, body}` (spec section 9), where `model` is the role's first model even when a fallback answered.
3. Set `ILLUS_LLM_MODE` back to `live` (or remove it for `replay`) and restart.
4. Before committing, look at the new files under `fixtures/llm`. Fixtures never store your prompts, the critic's PNG or tokens, but the model's answer includes **verbatim evidence quotes**. Never commit fixtures recorded from a private book (CLAUDE.md rule 7); delete them instead.

Record mode counts against the local caps and your plan like live mode. For the eval set use `pnpm eval --live --record` instead (see `evals/README.md`).

## Running on a VPS

OpenAI only redirects to `127.0.0.1`, so a browser on your laptop can't complete sign-in against a server elsewhere. OpenAI's documented approach for remote machines:

1. Do steps 1–4 on your laptop with the **same** `ILLUS_TOKEN_ENC_KEY` that the server will use.
2. Copy `chatgpt-tokens.enc` and `chatgpt-registration.json` from your laptop's `ILLUS_DATA_DIR` to the server's data volume over SSH.
3. On the server, give `chatgpt-registration.json` its own `hostId`: run `node -e "console.log('urn:uuid:' + crypto.randomUUID())"` and paste the output in. The server refreshes the tokens from then on.

The "Continue with ChatGPT" login page (§17) can't run on the VPS for the same reason. Until that is decided (an open question in ADR 0007), reach the VPS only over Tailscale.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| OpenAI shows a redirect or callback error | `ILLUS_PUBLIC_URL` is not `http://127.0.0.1:<the port you opened>`, or you used `localhost`. |
| "Sign-in took too long" / "state mismatch" | More than 10 minutes passed, or two sign-ins overlapped. Start again. |
| "This ChatGPT account is not allowed" | You signed in with an account other than `ILLUS_ALLOWED_ACCOUNT_ID`. |
| `/api/llm` returns `plan-limit` "local soft cap reached" | One of your local caps was reached. Wait, or raise the cap. |
| `/api/llm` returns `plan-limit` "see ChatGPT settings → Usage" | OpenAI's plan limit, the per-app cap or the five-hour window ran out. The reader pauses. Check usage in ChatGPT settings. |
| `/api/llm` returns `upstream` "no prompt file" | That role's `docs/prompts/<role>.md` hasn't been written yet. |
| `/auth/chatgpt/status` returns `{"configured": false}` | `ILLUS_TOKEN_ENC_KEY` or `ILLUS_PUBLIC_URL` is missing, or the server failed to start (bad `ILLUS_MODELS_JSON`, missing `ILLUS_SESSION_SECRET`). The reason is in the server log, not the response. Replay mode works without sign-in. |
| The critic fails with "request too large for /api/llm" | The rendered PNG made the request bigger than the route's 4 MB limit. The visual is kept with a `critic-failed` warning. |
| Start-up error "ILLUS_MODELS_JSON is invalid" | The message lists each bad key. Efforts must be `low`, `medium` or `high`, and every model must be on the allowlist. |
