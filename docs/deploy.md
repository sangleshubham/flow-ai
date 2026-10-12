# Deploying the reader

The reader is self-hosted and supports multiple ChatGPT accounts. Each visitor uses their own plan ([ADR 0055](adr/0055-multi-user-chatgpt-signin.md)). The existing Tailscale-only deployment boundary remains in place; this change does not upgrade Next 12 or change ADR 0005. See [setup-chatgpt-signin.md](setup-chatgpt-signin.md) for sign-in.

## Docker with ChatGPT sign-in

- The entrypoint creates `ILLUS_TOKEN_ENC_KEY` and `ILLUS_SESSION_SECRET` once in `/data/secrets.json` (mode 0600), preserving supplied values. Keep the data volume private and back it up as a secret.
- Set `ILLUS_PUBLIC_URL` to the address visitors open, and `ILLUS_LLM_MODE=live` to enable model calls. Compose defaults to `ILLUS_ACCESS=open`; sign-in works immediately with each visitor's account, without an owner-claim restart.
- Restrict sign-in with `ILLUS_ALLOWED_EMAILS=you@example.com,@example.org`, or restore single-owner behavior with `ILLUS_ACCESS=owner`. In owner mode only, the first sign-in claims an unconfigured reader and Docker needs one restart to expose the saved owner to Edge. Set an explicit `ILLUS_ALLOWED_ACCOUNT_ID` to avoid first-sign-in claiming.
- Remote readers use the paste flow: the ChatGPT tab ends at a `http://127.0.0.1:7199/auth/chatgpt/callback?…` page that cannot load. This is expected. Paste the complete address into the reader within ten minutes.
- There are no local model-request caps. Requests use the current account's plan until OpenAI reports its plan limit. Usage and the resulting pause are isolated per user.

## Configuration

| Variable                                                                                     | Needed                         | Value                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ILLUS_ALLOWED_ACCOUNT_ID`                                                                   | owner mode / optional password | Allowed owner `sub`; in owner mode a saved claimed owner is used when empty. Open-mode ChatGPT sign-in ignores this restriction.                                          |
| `ILLUS_ACCESS`                                                                               | optional                       | `open` (default) or `owner`; any other value is rejected.                                                                                                                 |
| `ILLUS_ALLOWED_EMAILS`                                                                       | optional                       | Comma-separated exact emails or `@domain`s, trimmed and case-insensitive; requires verified email. Open mode only.                                                        |
| `ILLUS_SOURCE_URL`                                                                           | optional                       | HTTP(S) source link shown on login; defaults to `https://github.com/sangleshubham/flow-ai`. Point it at the source of your deployed fork.                                 |
| `ILLUS_SESSION_SECRET`                                                                       | always                         | At least 32 random characters: `openssl rand -base64 48`. Changing it signs every browser out.                                                                            |
| `ILLUS_TOKEN_ENC_KEY`                                                                        | plan provider                  | 32-byte AES key, base64 or hex. Preserve it across upgrades and backups. Docker generates it if absent.                                                                   |
| `ILLUS_PUBLIC_URL`                                                                           | always                         | Laptop: `http://127.0.0.1:<port>` (OpenAI accepts only this form). VPS: its HTTPS tailnet URL, for example `https://reader.<tailnet>.ts.net`.                             |
| `ILLUS_DATA_DIR`                                                                             | outside replay                 | Private directory for `reader.db`, registration and generated secrets; `/data` in Docker.                                                                                 |
| `ILLUS_LOGIN_PASSWORD`                                                                       | VPS                            | Password for the login page, at least 16 characters: `openssl rand -base64 24`. Never reuse a password. Empty disables password login.                                    |
| `ILLUS_LLM_MODE`                                                                             | always                         | `replay` (the default) serves fixtures; `live` calls the model; `record` calls the model and saves responses.                                                             |
| `ILLUS_FIXTURES_DIR`                                                                         | replay/record containers       | Absolute container path. Compose defaults to `/fixtures/llm`, mounted read-only from `./fixtures/llm`. Recording needs a writable path, for example `/data/fixtures/llm`. |
| `ILLUS_MODELS_JSON`, `ILLUS_CHATGPT_CLIENT_ID`, `ILLUS_LLM_PROVIDER`, `ILLUS_OPENAI_API_KEY` | optional                       | See spec §9 and ADR 0007.                                                                                                                                                 |
| `ILLUS_AUTH_GATE`                                                                            | dev only                       | `off` skips the login gate under `pnpm dev`. Production builds ignore it.                                                                                                 |

Keep these in a file that is never committed: `apps/reader/.env.local` for `pnpm dev`/`next start`, or `.env` next to `docker-compose.yml` for Docker. Both names are git-ignored and excluded from the Docker build context.

## How the gate works

- Every page and API route needs the session cookie, except `/login`, `/auth/chatgpt/*` (with or without a locale prefix) and static files. Pages redirect to `/login`; APIs answer 401.
- `/login` offers **Continue with ChatGPT** for local and remote readers when auth is configured. The optional password form appears only when a known owner and a password of at least 16 characters are configured; it signs in as that owner.
- The session cookie is signed, `HttpOnly`, `SameSite=Lax`, valid for 30 days, and `Secure` when `ILLUS_PUBLIC_URL` is `https:`.
- `/api/llm` has no local request-rate limit. Unauthenticated ChatGPT sign-in endpoints share a ten-per-minute bucket per IP; password login allows five attempts per minute globally. The reverse proxy should replace client IP headers.
- Node routes require a live database session and enabled user in addition to the cookie signature. Revoked cookies may still load an HTML shell through Edge.
- To sign out of the app: `fetch('/api/login', { method: 'DELETE' })` in the browser console. Settings **Sign out** sends `POST /auth/chatgpt/logout`: the last active session also revokes that account’s ChatGPT tokens; other devices stay signed in.

## Local run (laptop)

Without Docker:

```sh
cp apps/reader/.env.local.example apps/reader/.env.local   # fill in the values above
pnpm i
pnpm --filter @flow/reader build
pnpm --filter @flow/reader exec next start -p 3000 -H 127.0.0.1
```

With `ILLUS_PUBLIC_URL=http://127.0.0.1:3000`, open exactly that URL (not `localhost`) and choose **Continue with ChatGPT**.

With Docker:

```sh
cp apps/reader/.env.local.example .env       # fill in; set ILLUS_LLM_MODE=live to call the model
docker compose up -d --build
```

The container listens on `127.0.0.1:3000` only. Its data lives in the `illus-data` volume. Compose mounts the repository's `fixtures/llm` directory read-only at `/fixtures/llm` and sets `ILLUS_FIXTURES_DIR` explicitly. The standalone server has no workspace manifest to discover fixtures from ([ADR 0031](adr/0031-w2-replay-fixture-resolution.md)); a direct `docker run` in replay mode must supply the same mount and environment variable. Live mode does not read fixtures.

Recording is an explicit choice that makes live model calls. To use it, set `ILLUS_LLM_MODE=record` and `ILLUS_FIXTURES_DIR=/data/fixtures/llm` in `.env`, then recreate the container with `docker compose up -d`. The server creates the directory as the unprivileged `node` user on the first recorded response. Keep the original read-only fixture mount for reference; it is never written. To replay recordings later, keep `/data/fixtures/llm` and change only `ILLUS_LLM_MODE` to `replay`. Treat recordings as private book data and include them in the data-volume backup, rather than committing them.

## Self-hosted tracing assets

The reader's `prebuild` and `predev` hooks invoke `@illus/tracer`'s `build:assets`. This creates `/pyodide/` plus `/illus-trace-worker.mjs`, `/illus-comlink.mjs` and `/illus-tracer.py` in `apps/reader/public`; generated files stay out of git. Docker installs the reader's workspace dependency graph, runs the same build, checks the worker and required Pyodide files exist, then copies the complete public directory into the standalone image. No CDN is used at runtime.

The worker response has a separate CSP: only same-origin script and asset loads plus WebAssembly compilation are allowed, with child workers disabled. Trusted bootstrap loads Pyodide and the trace runtime before W7 disables networking and Python bridge access. The CSP permits same-origin bootstrap reads; the runtime lockdown is what prevents executed code from making those reads afterward. App and HTML sandbox policies stay separate ([ADR 0038](adr/0038-w11-tracer-assets.md)). After upgrading, reload the reader so its PWA installs the matching worker and Pyodide assets.

## VPS over Tailscale only

Keep the VPS reachable only through the tailnet, preserving the existing Next 12 deployment boundary. Remote ChatGPT sign-in works through the paste flow; there is no need to copy a laptop's token files.

1. Install Docker and Tailscale (`tailscale up`) on the VPS. Enable MagicDNS and HTTPS certificates for the tailnet.
2. Copy the repository and configure `.env` with `ILLUS_ACCESS=open`, `ILLUS_LLM_MODE=live`, and `ILLUS_PUBLIC_URL=https://<vps-name>.<tailnet>.ts.net`. Optionally set `ILLUS_ALLOWED_EMAILS` and the source URL for your deployed fork.
3. Run `docker compose up -d --build`. The entrypoint creates persistent private secrets and the server opens `/data/reader.db`.
4. For an existing deployment, retain the data volume and encryption key. Legacy token/usage files migrate automatically; each browser signs in again once. Password login is optional and needs a known owner account.
5. **HTTPS on the tailnet**, one of:

   - `tailscale serve` (simplest): `sudo tailscale serve --bg --https=443 http://127.0.0.1:3000`. Only tailnet devices can connect; Tailscale issues the certificate.
   - Caddy bound to the tailnet address, if you prefer Caddy. Caddy gets the tailnet certificate from the local Tailscale daemon for `*.ts.net` names:

     ```
     {
       default_bind 100.x.y.z          # this machine's Tailscale IPv4 (tailscale ip -4)
     }
     <vps-name>.<tailnet>.ts.net {
       request_header -x-middleware-subrequest   # ADR 0005
       reverse_proxy 127.0.0.1:3000
     }
     ```

     Never add a public hostname or bind Caddy to the public interface. With `tailscale serve`, the `x-middleware-subrequest` advisory is already fixed by Next 12.3.7, and the API routes check the session themselves.

6. Check from a non-tailnet network that the VPS's public IP does not answer on 80, 443 or 3000 (a host firewall such as `ufw default deny incoming` plus `ufw allow in on tailscale0` makes sure).
7. Open `https://<vps-name>.<tailnet>.ts.net/login` from a tailnet device and choose **Continue with ChatGPT**. Complete the loopback paste flow using your own account.

## Reverse proxy timeouts

Model calls can take several minutes. `/api/llm` sends keep-alive data after 10 seconds while it waits for a slow call (ADR 0051), but the reverse proxy still needs a generous read timeout.

### Nginx and Nginx Proxy Manager

Plain nginx defaults `proxy_read_timeout` to 60 seconds. Nginx Proxy Manager (NPM) sets it to 90 seconds globally in `nginx.conf`, which can still be too short for a slow model call.

In NPM, open **Proxy Hosts** → the reader host → **Advanced** and append these directives. Keep any existing websocket lines:

```nginx
proxy_read_timeout 600s;
proxy_send_timeout 600s;
```

These server-level directives apply to NPM's generated `location /`; do not add a second `location /` block, which NPM does not allow you to redefine.

### Caddy

Caddy's `reverse_proxy` has no read timeout by default, so no timeout change is needed.

To confirm the timeout is resolved, check the proxy error log for new `upstream timed out` entries for `/api/llm`.

The OAuth callback URL is always `${ILLUS_PUBLIC_URL}/auth/chatgpt/callback`. It only matters where you sign in with ChatGPT, that is on the laptop, where it must be `http://127.0.0.1:<port>/auth/chatgpt/callback`. To sign in again later (a revoked or expired refresh token), repeat steps 1 and 4.

## Backups

Server state lives in `reader.db` (encrypted per-user tokens, revocable sessions, usage, pauses), `chatgpt-registration.json` and `secrets.json`. On first startup with the token key, legacy `chatgpt-tokens.enc` and the last 24 hours of `usage.jsonl` import once and become `.migrated` files. Existing cookies are invalidated and everyone signs in once more. Books and generated visuals stay in each browser's IndexedDB. Use SQLite's online backup facility, or stop the reader before copying the whole volume, including any WAL files; do not copy only a live `reader.db`.

```sh
# back up the volume to ./illus-data-YYYYMMDD.tgz
docker compose stop reader
docker run --rm -v flow-ai_illus-data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/illus-data-$(date +%Y%m%d).tgz -C /data .
docker compose start reader
# restore
docker compose stop reader
docker run --rm -v flow-ai_illus-data:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/illus-data-YYYYMMDD.tgz -C /data && chown -R 1000:1000 /data'
docker compose start reader
```

The volume name is `<compose project>_illus-data` (`docker volume ls`). Keep `ILLUS_TOKEN_ENC_KEY` and `ILLUS_SESSION_SECRET` in a password manager, not next to the backup.

## Upgrades

Back up the stopped reader's data volume first, then use `git pull --ff-only && docker compose up -d --build`. Preserve the existing encryption key and data volume. This authentication upgrade invalidates legacy cookies once, so everyone signs in again. Later database-backed sessions survive restarts unless the session secret changes or the sessions are revoked or expired.
