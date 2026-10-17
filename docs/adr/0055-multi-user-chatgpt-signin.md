# 0055 — Each visitor signs in with their own ChatGPT plan

- Status: accepted
- Date: 2026-10-17
- Workstream: W2, W11, W9; compatibility updates to W0 dependency documentation and W10 evals
- Spec sections: D6, D7, D10, §9, §15, §17

## Context

The user approved implementing `authentication_plan.md`. The single-user non-goal, D6, D7's single plan, D10's prohibition on a server database, §9's owner-only authentication and local caps, and §17's single-user gate no longer describe the requested behavior. Books and illustrations still live in browser IndexedDB. Only server authentication and usage become multi-user.

## Decision

Use built-in `node:sqlite` for `/data/reader.db` with WAL, foreign keys and a five-second busy timeout. Schema version 1 has `users`, `chatgpt_tokens`, `sessions`, `usage`, and `usage_pause`; `legacy_imports` records completed file imports so a crash between transaction commit and rename cannot duplicate usage. The directory is created with mode 0700 and the database with mode 0600. Migration transactions are ordered by `PRAGMA user_version`. Expired/revoked sessions are removed after seven days and usage after 90 days, on open and hourly.

AES-256-GCM token encryption binds each record to its `sub` through `illus:chatgpt-tokens:v2:<sub>`. Cookies contain a random session ID, identity and expiration, signed with HMAC. Tokens would exceed cookie limits and race on rotating refresh credentials; they also cannot be rotated into headers already sent by the LLM keep-alive stream. Refresh is serialized per account before reading its token row. Logout revokes the current session, and revokes/deletes that account's tokens when its last active session closes.

`ILLUS_ACCESS=open` is the default; any ChatGPT account may sign in. `ILLUS_ALLOWED_EMAILS` optionally restricts verified emails by exact address or exact `@domain`, case-insensitively. `ILLUS_ACCESS=owner` preserves explicit-owner and first-sign-in claiming behavior. The existing owner ID remains the optional password account in either mode. No new npm dependencies or core IR contracts are needed. `ILLUS_ACCESS` controls authentication rollout independently of illustration feature flags.

Remove both local request caps and the Edge `/api/llm` rate limit, reversing those parts of ADR 0007 and ADR 0020. Persist usage per account and pause only that account when upstream returns a plan-limit 429, until the supplied reset time or 30 minutes. The legacy cap variables only warn that they are ignored. Password brute-force protection remains five attempts per minute globally; ChatGPT start/paste/callback share ten attempts per minute per IP.

Edge verifies signature, identity, session ID and expiration (and the owner in owner mode). Every Node API verifies the database session and user enabled state. Edge cannot access SQLite: a revoked cookie may load a page shell but cannot use the APIs. The login page links to `ILLUS_SOURCE_URL` or this fork's source to support the AGPL network source requirement.

### Client registration adjustment to the plan

The plan proposed a shared issued client pending a two-account live spike. No live spike or inference calls were made during implementation. Current [OpenAI registration guidance](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) explicitly requires dynamic registration for a new ChatGPT account and says issued clients stay bound to their registered workspace. Therefore open mode uses `dynamic_agent_client` for unknown visitors, keeps the shared host ID, and stores each issued client ID only with that user's encrypted tokens. A known signed-in account reuses its own issued client ID and optional ID-token hint. Owner mode retains the shared registration-file client. [Refresh guidance](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) requires the client ID saved with the token set. This avoids depending on an unverified shared-client assumption.

## Consequences

Existing users sign in once more because legacy cookies lack a session ID. Legacy encrypted tokens and the last 24 hours of usage are imported transactionally, then the files are renamed with `.migrated`; newer token rows are never overwritten by a retry. Registration stays a non-secret JSON file. Keep the token encryption key across upgrades. Back up SQLite with its online backup facility or stop the container before copying the complete data volume; copying only a live main database can miss WAL writes.

This authorized integration updates W2 auth/server code, W11 gate/login/deployment, W9 account and usage display, their tests, the W0 dependency inventory, and W10 live eval call identity together. Existing package boundaries and IR contracts stay in place.

Limits: one Node process/container (refresh locks and sign-in buckets are in memory); browser profiles share IndexedDB even across account switches; no reader-side usage ceiling; Edge cannot observe revocation. An exhausted account's pause persists across restart. Email policy changes apply to subsequent sign-ins; revoke sessions or disable a user to terminate existing access. A real two-account deployment check is still required to verify provider consent and plan billing in the target environment.
