# 0020 — Login gate for a Tailscale-only VPS, and W11's security defaults (amends §17)

- Status: accepted (Shubham, 2026-10-09)
- Date: 2026-10-09
- Workstream: W11
- Spec sections: §17, §9, §2 D6, D7

## Context

§17 makes **Continue with ChatGPT** the only login and puts the VPS behind Caddy on the public internet. Two findings changed that:

- OpenAI accepts only `http://127.0.0.1:<port>` redirect URIs for open-source clients (ADR 0007 item 1), so the ChatGPT sign-in cannot complete against a VPS.
- Next 12.3 middleware can be bypassed on i18n Pages Router apps (GHSA-36qx-fr4f-26g5, fixed only in 15.5), so the middleware cannot be the only gate (ADR 0005).

Shubham's decision (build log, wave 1): sign in with ChatGPT on the laptop, copy the encrypted token file to the VPS, reach the VPS **only over Tailscale**, and give the VPS W11's own simple login gate for the one allowed account.

## Decision

1. **Two ways in, one account.** `/login` shows:
   - **Continue with ChatGPT** (W2's `/auth/chatgpt/start`) only when `ILLUS_PUBLIC_URL` is an `http://127.0.0.1[:port]` URL and sign-in is configured, i.e. on the laptop. W2's callback already refuses any `sub` other than `ILLUS_ALLOWED_ACCOUNT_ID`.
   - **Continue with password** when `ILLUS_LOGIN_PASSWORD` (new, at least 16 characters) is set. `POST /api/login` compares in constant time and issues the same signed session, always for `ILLUS_ALLOWED_ACCOUNT_ID`. Attempts are limited to 5 per minute in total (one global bucket, not per address). `DELETE /api/login` signs out of the app without revoking the ChatGPT tokens.
   The password is stored as plain text in the environment, next to `ILLUS_SESSION_SECRET` and `ILLUS_TOKEN_ENC_KEY`; whoever can read one can read all three, so hashing it adds nothing. It must be random and not reused.
2. **Access is Tailscale-only.** `docker-compose.yml` publishes the port on `127.0.0.1` only. HTTPS comes from `tailscale serve` (preferred) or Caddy bound to the tailnet address; Caddy strips `x-middleware-subrequest` (ADR 0005). The public-internet Caddy setup in §17 is no longer recommended.
3. **Session hardening** (in W2's `createSessions`, assigned to W11 by its agent file): sessions are bound to `ILLUS_ALLOWED_ACCOUNT_ID` (verify refuses, issue throws for any other `sub`), and cookies with extra segments are refused. Unchanged: HMAC-SHA256 with `ILLUS_SESSION_SECRET` (at least 32 characters), `HttpOnly`, `SameSite=Lax`, `Path=/`, 30 days. `Secure` is set when `ILLUS_PUBLIC_URL` is `https:`; on the laptop's `http://127.0.0.1` it cannot be (Safari drops `Secure` cookies on plain http). Rotating `ILLUS_SESSION_SECRET` signs every session out; there is no server-side session list.
4. **Middleware** (`apps/reader/src/middleware.ts`) runs on every path; `src/security/gate.ts` decides. Public: `/login`, `/<locale>/login`, `/auth/chatgpt/*`, `/<locale>/auth/chatgpt/*`, `/api/auth/chatgpt/*`, `/api/login`, `/_next/static/*`, and files from `public/` (a path whose last segment has an extension, outside `/api` and `/_next/data`). Anything else is gated: pages redirect to `/login?next=…`, `/api/*` and `/_next/data/*` answer 401 `{ ok: false, code: 'auth' }`. Unknown paths are gated, never public. The middleware verifies the HMAC with Web Crypto (Edge runtime) and also checks the account. API routes keep their own session check (ADR 0005).
5. **Rate limit**: `/api/llm` allows 60 requests per minute per session (token bucket keyed by the signed cookie, in the middleware's memory). Over the limit: HTTP 429, `Retry-After`, body `{ ok: false, code: 'upstream', retryAfterMs }`. `upstream` because the §9 codes have no rate-limit code and `plan-limit` would pause all plan requests in the client; a code `rate-limit` would be a contract change. Needs `experimental.allowMiddlewareResponseBody` in Next 12.3.
6. **Dev escape hatch**: `ILLUS_AUTH_GATE=off` disables the gate only under `next dev`; production builds (`next start`, Docker) ignore it.
7. **Headers** (`apps/reader/security-headers.js`): the ADR 0001 amended app CSP plus `form-action 'self'` and `frame-ancestors 'self'` on every path except `/illus-sandbox.html`, which gets exactly the §17 sandbox policy and no `frame-ancestors`. Also `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` (`no-referrer` on the sandbox), `X-Frame-Options: SAMEORIGIN`, `Cross-Origin-Opener-Policy: same-origin`, a restrictive `Permissions-Policy`, `Strict-Transport-Security` (ignored on plain http), no `X-Powered-By`. Dev adds `'unsafe-eval'` to `script-src`. Header rules do not use `locale: false`: with i18n, Next 12.3 matches them against the locale-prefixed path (same bug as ADR 0007 item 11).
8. **Removed** (Shubham's decision): Dropbox sync, remote-URL import (including the "download sample book" button, which fetched from epubtest.org), Sentry (`withSentryConfig`, configs, `ErrorBoundary`, `_error.js`), and Google Tag Manager (inline script, third-party origin). Flow's local zip export/import stays. The two inline scripts in `_document.tsx` became `public/theme-init.js`.
9. **next-pwa**: disabled in development; a first `NetworkOnly` rule keeps every `/api/`, `/auth/` and `/login` response out of the service-worker cache.

## Consequences

- §17 "Auth gate" and §9 "Environment variables" should read as above; `ILLUS_LOGIN_PASSWORD` and `ILLUS_AUTH_GATE` are new variables.
- Any E2E against a production build must set `ILLUS_SESSION_SECRET` and `ILLUS_ALLOWED_ACCOUNT_ID` and add a session cookie (`apps/reader/e2e/env.ts` shows how).
- The rate limit and the middleware gate live in process memory and can be bypassed by the Next 12 i18n advisory; the per-route session check and W2's soft caps remain the real controls until the Next 15.5 migration (ADR 0005).
- W2: `createSessions` takes `allowedSub`; `createIllusServer` passes `ILLUS_ALLOWED_ACCOUNT_ID`.

## Decision (Shubham, 2026-10-09)

Accepted. Password login (`ILLUS_LOGIN_PASSWORD`) is the VPS gate. The session cookie is not `Secure` on `http://127.0.0.1`: `Secure` follows the scheme of `ILLUS_PUBLIC_URL`, as built. Spec §9 and §17 now read as this ADR (amended when W0 ported the decisions after wave 3, [ADR 0042](0042-w0-post-wave3-port.md)).
