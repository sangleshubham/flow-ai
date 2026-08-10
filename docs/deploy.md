# Deploying the reader

The reader is single-user and self-hosted (spec D6). It runs on your laptop, or on a personal VPS that only your Tailscale devices can reach ([ADR 0020](adr/0020-w11-login-gate-and-deployment.md)). Model calls run on your ChatGPT plan; sign-in itself is covered in [setup-chatgpt-signin.md](setup-chatgpt-signin.md).

## Configuration

| Variable | Needed | Value |
| --- | --- | --- |
| `ILLUS_ALLOWED_ACCOUNT_ID` | always | Your ChatGPT account id (the ID token `sub`). Leave empty for the first sign-in: the refusal page shows the value to put here. |
| `ILLUS_SESSION_SECRET` | always | At least 32 random characters: `openssl rand -base64 48`. Changing it signs every browser out. |
| `ILLUS_TOKEN_ENC_KEY` | always | 32-byte key for the token store: `openssl rand -base64 32`. **Use the same key on the laptop and the VPS.** |
| `ILLUS_PUBLIC_URL` | always | Laptop: `http://127.0.0.1:<port>` (OpenAI accepts only this form). VPS: its HTTPS tailnet URL, for example `https://reader.<tailnet>.ts.net`. |
| `ILLUS_DATA_DIR` | always | Token store and usage log. `/data` in Docker (a volume). |
| `ILLUS_LOGIN_PASSWORD` | VPS | Password for the login page, at least 16 characters: `openssl rand -base64 24`. Never reuse a password. Empty disables password login. |
| `ILLUS_LLM_MODE` | always | `live` to call the model; `replay` (the default) only serves recorded fixtures. |
| `ILLUS_MAX_REQUESTS_5H`, `ILLUS_MAX_REQUESTS_DAY` | optional | Local soft caps, default 100 and 300. |
| `ILLUS_MODELS_JSON`, `ILLUS_CHATGPT_CLIENT_ID`, `ILLUS_LLM_PROVIDER`, `ILLUS_OPENAI_API_KEY` | optional | See spec §9 and ADR 0007. |
| `ILLUS_AUTH_GATE` | dev only | `off` skips the login gate under `pnpm dev`. Production builds ignore it. |

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

The container listens on `127.0.0.1:3000` only. Its data lives in the `illus-data` volume.

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
