# Deploying the reader

The reader is single-user and self-hosted (spec D6). It runs on your laptop, or on a personal VPS that only your Tailscale devices can reach ([ADR 0020](adr/0020-w11-login-gate-and-deployment.md)). Model calls run on your ChatGPT plan; sign-in itself is covered in [setup-chatgpt-signin.md](setup-chatgpt-signin.md).

## Docker with ChatGPT sign-in and no secrets in `.env`

Since [ADR 0047](adr/0047-remote-chatgpt-signin-and-zero-config.md), the Docker image needs no secrets in `.env`:

- On first start, the entrypoint generates `ILLUS_TOKEN_ENC_KEY` and `ILLUS_SESSION_SECRET` and saves them in `/data/secrets.json` (mode 0600). If they are set in the environment, it saves those values instead, so an existing deployment can drop them from `.env` after one start.
- The first account to finish "Continue with ChatGPT" becomes the owner (`ownerSub` in `/data/chatgpt-registration.json`). The entrypoint sets `ILLUS_ALLOWED_ACCOUNT_ID` from it, so on a fresh volume you restart once after that sign-in: `docker compose restart reader`. **Sign in straight after the first start.** Until then, anyone who reaches the reader can claim it. Setting `ILLUS_ALLOWED_ACCOUNT_ID` turns claiming off.
- When `ILLUS_PUBLIC_URL` is not `http://127.0.0.1…`, sign-in ends with a paste step, because OpenAI redirects only to a loopback address. The ChatGPT tab finishes on a `http://127.0.0.1:7199/auth/chatgpt/callback?…` page that cannot load. Copy its full address into the reader's form within 10 minutes.
- What is left to set: `ILLUS_PUBLIC_URL` (for the `Secure` cookie and paste sign-in), `ILLUS_LLM_MODE=live`, and optionally the request caps. `ILLUS_LOGIN_PASSWORD` is optional.
- `/data/secrets.json` sits next to the encrypted tokens, so the data volume alone unlocks them. Treat volume backups as secrets, or keep `ILLUS_TOKEN_ENC_KEY` in the environment.

## Configuration

| Variable                                                                                     | Needed                   | Value                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ILLUS_ALLOWED_ACCOUNT_ID`                                                                   | always                   | Your ChatGPT account id (the ID token `sub`). Leave empty for the first sign-in: the refusal page shows the value to put here.                                            |
| `ILLUS_SESSION_SECRET`                                                                       | always                   | At least 32 random characters: `openssl rand -base64 48`. Changing it signs every browser out.                                                                            |
| `ILLUS_TOKEN_ENC_KEY`                                                                        | always                   | 32-byte key for the token store: `openssl rand -base64 32`. **Use the same key on the laptop and the VPS.**                                                               |
| `ILLUS_PUBLIC_URL`                                                                           | always                   | Laptop: `http://127.0.0.1:<port>` (OpenAI accepts only this form). VPS: its HTTPS tailnet URL, for example `https://reader.<tailnet>.ts.net`.                             |
| `ILLUS_DATA_DIR`                                                                             | always                   | Token store and usage log. `/data` in Docker (a volume).                                                                                                                  |
| `ILLUS_LOGIN_PASSWORD`                                                                       | VPS                      | Password for the login page, at least 16 characters: `openssl rand -base64 24`. Never reuse a password. Empty disables password login.                                    |
| `ILLUS_LLM_MODE`                                                                             | always                   | `replay` (the default) serves fixtures; `live` calls the model; `record` calls the model and saves responses.                                                             |
| `ILLUS_FIXTURES_DIR`                                                                         | replay/record containers | Absolute container path. Compose defaults to `/fixtures/llm`, mounted read-only from `./fixtures/llm`. Recording needs a writable path, for example `/data/fixtures/llm`. |
| `ILLUS_MAX_REQUESTS_5H`, `ILLUS_MAX_REQUESTS_DAY`                                            | optional                 | Local soft caps, default 100 and 300.                                                                                                                                     |
| `ILLUS_MODELS_JSON`, `ILLUS_CHATGPT_CLIENT_ID`, `ILLUS_LLM_PROVIDER`, `ILLUS_OPENAI_API_KEY` | optional                 | See spec §9 and ADR 0007.                                                                                                                                                 |
| `ILLUS_AUTH_GATE`                                                                            | dev only                 | `off` skips the login gate under `pnpm dev`. Production builds ignore it.                                                                                                 |

Keep these in a file that is never committed: `apps/reader/.env.local` for `pnpm dev`/`next start`, or `.env` next to `docker-compose.yml` for Docker. Both names are git-ignored and excluded from the Docker build context.

## How the gate works

- Every page and API route needs the session cookie, except `/login`, `/auth/chatgpt/*` (with or without a locale prefix) and static files. Pages redirect to `/login`; APIs answer 401.
- `/login` offers **Continue with ChatGPT** when `ILLUS_PUBLIC_URL` is a `127.0.0.1` URL, and **Continue with password** when `ILLUS_LOGIN_PASSWORD` is set. Both admit only `ILLUS_ALLOWED_ACCOUNT_ID`.
- The session cookie is signed, `HttpOnly`, `SameSite=Lax`, valid for 30 days, and `Secure` when `ILLUS_PUBLIC_URL` is `https:`.
- `/api/llm` allows 60 requests per minute per session.
- To sign out of the app: `fetch('/api/login', { method: 'DELETE' })` in the browser console. To also revoke the ChatGPT tokens: `POST /auth/chatgpt/logout`.

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

The VPS is never exposed to the internet. ChatGPT sign-in cannot run there (OpenAI only redirects to `127.0.0.1`), so you sign in on the laptop and copy the token store.

1. **Laptop:** run the reader locally (above) with the `ILLUS_TOKEN_ENC_KEY` you will use on the VPS, and sign in with ChatGPT once.
2. **VPS:** install Docker and Tailscale (`tailscale up`). Turn on MagicDNS and HTTPS certificates for the tailnet in the Tailscale admin console.
3. **VPS:** copy the repository, create `.env` with the same `ILLUS_TOKEN_ENC_KEY` and `ILLUS_ALLOWED_ACCOUNT_ID`, a fresh `ILLUS_SESSION_SECRET`, an `ILLUS_LOGIN_PASSWORD`, `ILLUS_LLM_MODE=live`, and `ILLUS_PUBLIC_URL=https://<vps-name>.<tailnet>.ts.net`. Then `docker compose up -d --build`.
4. **Copy the tokens** from the laptop's `ILLUS_DATA_DIR` into the volume, then give the VPS its own host id (setup-chatgpt-signin.md, "Running on a VPS"):

   ```sh
   scp chatgpt-tokens.enc chatgpt-registration.json vps:/tmp/
   ssh vps 'docker cp /tmp/chatgpt-tokens.enc reader:/data/ && docker cp /tmp/chatgpt-registration.json reader:/data/ \
     && docker exec -u 0 reader chown node:node /data/chatgpt-tokens.enc /data/chatgpt-registration.json && rm /tmp/chatgpt-*'
   ```

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
7. Open `https://<vps-name>.<tailnet>.ts.net/login` from a tailnet device and continue with the password.

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

Everything server-side lives in the data volume: `chatgpt-tokens.enc` (encrypted, useless without `ILLUS_TOKEN_ENC_KEY`), `chatgpt-registration.json` and `usage.jsonl`. Books and generated visuals live in the browser (IndexedDB, spec D10); back them up with the library's **Export** button and the cache export.

```sh
# back up the volume to ./illus-data-YYYYMMDD.tgz
docker run --rm -v flow-ai_illus-data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/illus-data-$(date +%Y%m%d).tgz -C /data .
# restore
docker compose stop reader
docker run --rm -v flow-ai_illus-data:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/illus-data-YYYYMMDD.tgz -C /data && chown -R 1000:1000 /data'
docker compose start reader
```

The volume name is `<compose project>_illus-data` (`docker volume ls`). Keep `ILLUS_TOKEN_ENC_KEY` and `ILLUS_SESSION_SECRET` in a password manager, not next to the backup.

## Upgrades

`git pull && docker compose up -d --build`. The volume survives. Sessions survive unless `ILLUS_SESSION_SECRET` changes.
