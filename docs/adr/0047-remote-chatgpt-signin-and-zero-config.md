# 0047 — Sign in with ChatGPT on a remote reader, and no required configuration

- Status: accepted (requested by Shubham, 2026-10-11)
- Date: 2026-10-11
- Workstream: W2 and W11
- Spec sections: §9, §17

## Context

ADR 0007 item 1: OpenAI redirects only to `http://127.0.0.1:<port>`, so "Continue with ChatGPT" could not finish on a reader served from a public host name. Remote use meant signing in on a laptop, copying `chatgpt-tokens.enc` and `chatgpt-registration.json` to the server, and fixing its host id by hand. A Docker deployment also needed four values in `.env` before it would start: `ILLUS_TOKEN_ENC_KEY`, `ILLUS_SESSION_SECRET`, `ILLUS_ALLOWED_ACCOUNT_ID` and (for the password gate, ADR 0020) `ILLUS_LOGIN_PASSWORD`. Shubham asked for the deployed reader to take everything it needs from the ChatGPT sign-in, with nothing in `.env` except the request caps.

## Decision

1. **Paste sign-in.** When `ILLUS_PUBLIC_URL` is not an `http://127.0.0.1` URL (`IllusServer.pasteSignin`), sign-in uses the fixed redirect URI `PASTE_REDIRECT_URI` (`http://127.0.0.1:7199/auth/chatgpt/callback`). `/auth/chatgpt/start` sets the sealed pending cookie as before but shows a page instead of redirecting: open the OpenAI sign-in in a new tab, then paste the address that tab ends on (a page that cannot load) into a form. `POST /auth/chatgpt/paste` takes that URL's query and runs the existing callback. State, nonce, PKCE verifier, client id checks and the 10-minute expiry are unchanged. They bind the pasted code to the browser that started the sign-in. Port 7199 is unlikely to be in use, so the code normally reaches nothing on the user's machine.
2. **The first sign-in claims the reader.** Without `ILLUS_ALLOWED_ACCOUNT_ID`, `createIllusServer` passes `claimOwner`. The first account to complete sign-in is saved as `ownerSub` in `chatgpt-registration.json`, and every other account is then refused and its refresh token revoked (as before). An explicit `ILLUS_ALLOWED_ACCOUNT_ID` still wins and disables claiming. `logout` keeps the owner.
3. **Generated secrets.** The Docker image starts `apps/reader/docker-entrypoint.mjs`, which creates `ILLUS_DATA_DIR/secrets.json` (mode 0600) on first start with a random token key and session secret. It copies values from the environment instead when they are given, so an existing deployment keeps its keys and can then drop them from `.env`. It also sets `ILLUS_ALLOWED_ACCOUNT_ID` from the saved `ownerSub`. Environment variables always take precedence.
4. **The Edge gate is unchanged.** Middleware still admits only `ILLUS_ALLOWED_ACCOUNT_ID` and refuses everything when it is unset. Middleware can read only environment variables, which is why the entrypoint loads the owner. On a fresh deployment, the claiming sign-in therefore ends on a page asking for one restart (`docker compose restart reader`).
5. `ILLUS_PUBLIC_URL` is no longer needed for sign-in (`auth` exists whenever there is a token key). It still sets the `Secure` cookie flag and selects paste sign-in. The login page shows "Continue with ChatGPT" whenever sign-in is configured. The password form still needs a known owner and an `ILLUS_LOGIN_PASSWORD` of at least 16 characters, and remains optional.

## Consequences

- **Claiming is first come, first served.** A public deployment that has not been claimed can be claimed by anyone who reaches it first. Sign in straight after the first start, or set `ILLUS_ALLOWED_ACCOUNT_ID`. Once claimed, ownership changes only by editing `chatgpt-registration.json`, or by setting the variable.
- **The token key now lives in the same volume as the encrypted tokens** unless it is given in the environment. A copy of the volume alone is then enough to use the tokens. Back the volume up as a secret, or keep supplying `ILLUS_TOKEN_ENC_KEY` from outside the volume.
- The ChatGPT refresh token is used only on the server, so a laptop that shared its token file stops working once the server refreshes. Sign in on each machine separately.
- Tests: `packages/illus-llm/test/chatgpt-auth.test.ts` (claiming, explicit owner wins, paste redirect URI), `server-env.test.ts` (no public URL needed, paste selection), `apps/reader/src/server/auth/status-route.test.ts` (start page, paste, restart notice, bad input). `apps/reader/src/security/gate.test.ts` is unchanged.
- Docs: `docs/deploy.md` and `docs/setup-chatgpt-signin.md`.
