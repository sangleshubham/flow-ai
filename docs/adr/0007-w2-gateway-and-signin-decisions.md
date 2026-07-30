# 0007 — Gateway and Sign in with ChatGPT: where OpenAI's docs differ from the spec, and W2 defaults

- Status: proposed (items 1–3 need Shubham's decision; 4–10 are W2's conservative defaults)
- Date: 2026-10-09
- Workstream: W2 (affects W11, W9, W0, W10)
- Spec sections: §9, §15, §17, §5

## Context

§9 asks W2 to re-check OpenAI's Sign in with ChatGPT pages at implementation time. On 2026-10-09 the
open-source plan-usage pages (Registration and sign-in, Accounts and sessions, Token reference, Errors
and recovery, Models and inference, Self-hosted VMs, Preview limitations) say several things the spec
does not, and Next.js 12.3.4 behaves differently from what `docs/flow-audit.md` §3 assumed.

## Decision

**Differences from the spec (need Shubham's decision; implemented as described)**

1. **Redirect URI must be a loopback on `127.0.0.1`.** OpenAI: "Use an HTTP loopback URI on
   `127.0.0.1` … Don't substitute `localhost`. Only the port may change." The callback stays
   `${ILLUS_PUBLIC_URL}/auth/chatgpt/callback` (§9), so `ILLUS_PUBLIC_URL` must be
   `http://127.0.0.1:<port>` when signing in. **Consequence for the VPS deployment (§17, W11):** a
   browser on another machine cannot complete sign-in against the VPS. OpenAI's documented path for
   remote hosts is to sign in locally and copy the credential file to the VM. With this code that means:
   sign in on the laptop, then copy `chatgpt-tokens.enc` and `chatgpt-registration.json` from
   `ILLUS_DATA_DIR` to the VPS volume (same `ILLUS_TOKEN_ENC_KEY`), keeping the VPS's own host id
   (edit `hostId` back in `chatgpt-registration.json`). **"Continue with ChatGPT" as the VPS login gate
   (§17) therefore does not work as specified**; W11 needs another login for remote access (Tailscale
   only, or a local-only gate). Open question for Shubham.
2. **No pre-registered client id.** Open-source clients register dynamically at first sign-in:
   `client_id=dynamic_agent_client` plus `agent_name_hint`; the callback returns the issued
   `oaiapp_…` id, which is saved in `ILLUS_DATA_DIR/chatgpt-registration.json` and used from then on.
   `ILLUS_CHATGPT_CLIENT_ID` becomes **optional** (an override only). The "register the open-source
   client" step in §9 is the first sign-in.
3. **Extra authorization parameters.** Every authorization sends `resource=https://api.openai.com/v1`,
   a persistent `ext_agent_host_id` (`urn:uuid:…`, created once per host), `nonce`, and the scopes
   `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`; re-sign-ins send
   `id_token_hint`. Token exchange and refresh send `resource`. Inference is refused (`signin-required`)
   unless `chatgpt.tokens.use.direct` was granted. The account identity is the ID token `sub`, so
   `ILLUS_ALLOWED_ACCOUNT_ID` holds the `sub`.

**W2 defaults (conservative choices where the spec is silent)**

4. **Allowed account at the callback.** The callback refuses any `sub` other than
   `ILLUS_ALLOWED_ACCOUNT_ID` before storing tokens, and revokes the refused refresh token. When the
   variable is unset, every account is refused and the page shows the `sub` to put there (first-run
   discovery). W11 may harden this further.
5. **Local soft caps:** starting values `ILLUS_MAX_REQUESTS_5H=100` and `ILLUS_MAX_REQUESTS_DAY=300`
   (rolling windows), counting every upstream request including retries and fallbacks, re-read from
   `usage.jsonl` at start-up. Tuned after the M1 eval (§9). Indexing counts against them.
6. **Plan-limit pause.** After a 429 `subscription_sharing_usage_limit_exceeded` (HTTP or a
   `response.failed` event mid-stream) all plan requests pause until the reset time when one is given
   (`retry-after`), otherwise for 30 minutes; OpenAI says not to infer a reset time, so `retryAfterMs` is
   returned only when provided. Never retried, never a fallback model, never another provider.
7. **Provider selection.** `ILLUS_LLM_PROVIDER` (new, optional) selects `chatgpt-plan` (default) or
   `openai-api-key`; the latter also needs `ILLUS_OPENAI_API_KEY`. Nothing switches providers
   automatically. `ILLUS_CHATGPT_ISSUER` (new, optional) exists for tests only.
8. **Fixture key model.** The `model` in the §9 fixture key is the route's **primary** model; the model
   that actually answered is stored in the fixture (`usedModel`). Replay cannot know which fallback a
   recording used. Recorded fixtures do not store `prefix`/`body` (no book text in fixtures, CLAUDE.md
   rule 7); hand-written ones may include them instead of a `key`.
9. **Structured output.** `text.format` json_schema strict first. The strict adapter makes optional
   properties required-and-nullable (nulls stripped before the Zod parse), turns homogeneous tuples
   (`ChartIR.domain`, `points`) into fixed-length arrays, maps `oneOf` to `anyOf`, and drops keywords
   strict mode does not document (`minLength`, `maxLength`, `format`, …); the server's Zod parse still
   enforces them. On a 400 with `param` `text…`, the gateway switches (once per process) to one function
   tool `emit_<Schema>` in namespace `illus`, forced with `tool_choice: "required"` (the SDK's
   `ToolChoiceFunction` has no namespace field, and one tool plus `required` forces it). `TemplateIR`
   is strict only when W5's registry is passed to the gateway; until then `props` is open and the schema
   is sent with `strict: false`. No ADR 0003 contract change is needed for `ChartIR` tuples.
10. **Fallback-chain triggers.** "Model unavailable" = HTTP 404, codes `model_not_found` /
    `model_not_available` / `model_not_supported`, or `subscription_sharing_unsupported_capability`
    with `param: "model"`. OpenAI does not document a model-entitlement code yet; re-check at M0.
    `subscription_sharing_usage_unavailable` and `…_user_unavailable` (503) are retried with backoff;
    `…_user_not_eligible` (403) is not retried.
11. **Rewrite without `locale: false`.** With i18n, Next.js 12.3.4 inserts the default locale before
    matching, so `{ source: '/auth/chatgpt/:action', locale: false }` never matches (tested: 404). The
    rule without `locale: false` serves `/auth/chatgpt/*` and `/<locale>/auth/chatgpt/*` (tested: both
    reach the route). W11's middleware matcher must cover both forms.
12. **Extra routes.** `GET /auth/chatgpt/status` (signed-in account, plan scope, expiry, usage; session
    required) and `GET /api/llm/usage` (usage against the caps, for the pane, §15). `logout` is
    `POST` and needs a session.

## Consequences

- **Blocker for `next build` (W9 / W0, orchestrator merge order).** The W2 app wiring commit makes
  `apps/reader` import `@illus/*` for the first time. `next build` then needs: (a) W9's prerequisites
  from flow-audit §11 (root `typescript` 5.9.3, `allowImportingTsExtensions` in
  `apps/reader/tsconfig.json`, the three Flow type fixes), (b) `@types/node` ≥ 22 in `apps/reader`
  (Flow's 17.0.22 breaks `Buffer` typing under TS 5.9), and (c) **a contract-change request to W0**:
  Next 12.3's SWC cannot parse `satisfies` (`@illus/core/src/schemas/llm.ts:122`, `ROLES`). Suggested
  fix keeping literal types and using only syntax SWC 12 parses:
  `function defineRoles<T extends Record<RoleName, RoleSpec>>(r: T): T`, called with `{ … } as const`
  (no TS 5 `const` type parameter either), or a Next upgrade per ADR 0005. With (a)–(c) applied locally, `next build` succeeded and the routes
  answered correctly in replay mode. The CI gate (`lint typecheck test`) is green without them, because
  `apps/reader` has no typecheck script.
- W11: login gate design for the VPS (item 1), middleware matcher for locale-prefixed auth paths
  (item 11), next-pwa must not cache `/auth/` or `/api/` (flow-audit §7), rate limit on `/api/llm`.
- W3/W9: the browser client needs prompt versions; `apps/reader/src/server/llm/prompt-files.ts`
  exports the raw files (safe for the browser) for `createPromptRegistry`.
- Every role owner: `/api/llm` returns `upstream` "no prompt file" until `docs/prompts/<role>.md` exists.
