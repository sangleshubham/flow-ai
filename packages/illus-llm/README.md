# @illus/llm

The typed model client (`llm.call(role, ctx, opts)`), and in `@illus/llm/server` the `/api/llm` gateway on Shubham's ChatGPT plan via Sign in with ChatGPT.

- Owner: W2
- Spec: §9 (gateway, sign-in, client, roles, model mapping), §15 (plan usage controls), §17 (token handling)
- Decisions: [ADR 0006](../../docs/adr/0006-w2-llm-server-entry-and-test-deps.md) (server entry), [ADR 0007](../../docs/adr/0007-w2-gateway-and-signin-decisions.md) (OpenAI rules, defaults)
- Setup for a live account: [docs/setup-chatgpt-signin.md](../../docs/setup-chatgpt-signin.md)

## Public API: `@illus/llm` (browser-safe)

| Export                                                                              | What it does                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createLlmClient({ transport, prompts, log?, debugPrompts? })`                      | Implements `LlmCall` from `@illus/core`. `call(role, ctx, opts)` is typed by role (and by `opts.schemaName` for multi-schema roles). It honours `opts.signal`: an abort rejects at once with `LlmError('aborted')` and nothing is returned for caching. It writes one `llmLog` row per call, with prompts only when `debugPrompts()` is true. It re-validates the output with the role's schema. |
| `httpTransport({ url? })`                                                           | POST to `/api/llm` (browser). The server applies `ILLUS_LLM_MODE`.                                                                                                                                                                                                                                                                                                                               |
| `replayTransport({ fixtures, models })`                                             | Fixtures only, no network (Node tests of other packages).                                                                                                                                                                                                                                                                                                                                        |
| `recordTransport({ live, fixtures, models })` · `transportFor(mode, deps)`          | Live plus fixture capture. Mode selection.                                                                                                                                                                                                                                                                                                                                                       |
| `fixtureKey(...)`, `Fixture`, `memoryFixtures(list)`, `llmModeFrom(env)`            | Fixture key = SHA-256 of `{role, promptVersion, model, prefix, body}`, where `model` is the role's primary model. `memoryFixtures` accepts hand-written fixtures (`"source": "handwritten"`) with `prefix` and `body` instead of a `key`.                                                                                                                                                        |
| `DEFAULT_MODELS`, `loadModelsConfig(json)`, `resolveRoute(config, role, escalate?)` | `ILLUS_MODELS_JSON` loader and validator (efforts only `low`/`medium`/`high`, allowlist) and tier → model chain with an explicit effort per entry.                                                                                                                                                                                                                                               |
| `createPromptRegistry(files)`, `parsePromptFile(text, role?)`                       | Parses `docs/prompts/<role>.md`: front matter plus `## System prompt`, `## Examples`, `## Failure modes`.                                                                                                                                                                                                                                                                                        |
| `outputSchema(name, { templateId?, templates? })`, `stripAddedNulls`                | Zod → strict-mode JSON Schema adapter, and the inverse null stripping.                                                                                                                                                                                                                                                                                                                           |
| `LlmProvider`, `ProviderError`, `ProviderRequest` …                                 | Provider adapter types (`chatgpt-plan`, `openai-api-key`).                                                                                                                                                                                                                                                                                                                                       |

## Public API: `@illus/llm/server` (Node only, imported by `apps/reader/src/server`)

| Export                                                                         | What it does                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createIllusServer(env, { prompts, templates?, fixtures? })`                   | Builds everything from the §9 environment variables and fails fast on bad config. Returns `{ gateway, auth, sessions, usage, mode, provider, models, pasteSignin, access, ownerSub }`.                                                         |
| `createGateway(deps).handle(body, { sub, signal })`                            | §9 steps 1–8 → `{ status, body: LlmResponse }`.                                                                                                                                                                                                |
| `createChatGptAuth(...)`                                                       | `start({ sub?, next? }?)`, `callback(params, pending)`, `getPlanToken(sub)` (refreshes within 5 minutes, serialized per account), `logout(sub)`, `status(sub)`. Open/owner policy and verified-email restrictions are checked during callback. |
| `openReaderDb({ dir } \| { memory: true })`, `migrateLegacyFiles(db, options)` | Built-in SQLite storage, schema/retention and idempotent migration of legacy token/usage files.                                                                                                                                                |
| `createSessions({ db, secret, secure, allowedSub? })`                          | Issues signed session IDs backed by revocable database rows; verifies identity, expiry and enabled users. Includes `revoke(sid)`, `activeCount(sub)` and `clearCookie()`.                                                                      |
| `createTokenStore({ db, dir, key })`, `seal`/`unseal`, `parseEncKey`           | AES-256-GCM records bound to each account in `reader.db`; `loadTokens(sub)`, `saveTokens(tokens)` and `clearTokens(sub)`. Registration remains a JSON file.                                                                                    |
| `createUsageTracker({ db, now? }).forUser(sub)`                                | Per-user `append(row)`, `summary()`, `pause(until)` and `pausedUntil()`. Summary is `{ used5h, usedDay, pausedUntil }`; no local caps.                                                                                                         |
| `createOpenAiProvider({ id })`, `classify`                                     | Responses API over the `openai` SDK: `store: false`, `stream: true`, `reasoning.effort` always set, `text.format` strict, or the namespaced tool fallback.                                                                                     |
| `fileFixtures(dir)`                                                            | `fixtures/llm/<role>/<key>.json` store.                                                                                                                                                                                                        |

The reusable server defaults to `<cwd>/fixtures/llm` when `ILLUS_FIXTURES_DIR` and an injected store are absent. The reader app resolves that default from its nearest workspace root in replay/record mode (including launches from `apps/reader`); it preserves explicit overrides. See [reader server README](../../apps/reader/src/server/llm/README.md) and [ADR 0031](../../docs/adr/0031-w2-replay-fixture-resolution.md). Every on-disk fixture is validated on load; invalid envelopes still fail initialization.

**Critic image.** `call('critic', ctx, { image: { mediaType: 'image/png', base64 } })` sends the PNG to the gateway, which forwards it as an `input_image` data-URL part after the body text (`detail: 'auto'`). Only roles with `ROLES[role].image` may send one (400 otherwise). The `/api/llm` route accepts bodies up to 4 MB; a larger request comes back as `upstream` "request too large". The image is not part of the fixture key (§9) and is never stored in a fixture.

## Example

```ts
import {
  createLlmClient,
  createPromptRegistry,
  httpTransport,
} from '@illus/llm'

const llm = createLlmClient({
  transport: httpTransport(),
  prompts: createPromptRegistry(PROMPT_FILES),
  log: repos.llmLog,
})
const {
  data: plan,
  model,
  effort,
} = await llm.call('planner', { prefix, body }, { signal, bookId, sectionId })
// plan is a VisualPlan. Errors are LlmError with code 'plan-limit' | 'signin-required' | 'schema' | …
```

Tests in other packages (no server, no network):

```ts
import {
  DEFAULT_MODELS,
  createLlmClient,
  memoryFixtures,
  replayTransport,
} from '@illus/llm'

const fixtures = await memoryFixtures([
  {
    source: 'handwritten',
    role: 'planner',
    promptVersion: '1.0.0',
    model: 'gpt-6.1-sol',
    effort: 'medium',
    schemaName: 'VisualPlan',
    prefix,
    body,
    data: plan,
  },
])
const llm = createLlmClient({
  transport: replayTransport({ fixtures, models: DEFAULT_MODELS }),
  prompts,
})
```

## Scripts

- `pnpm lint` · `pnpm typecheck` · `pnpm test`. The tests use an in-process fake OIDC server and a fake Responses API stream, with no network.
- `scripts/verify-models.ts`: makes **live** calls, so only Shubham runs it (the setup guide; choose the account with `ILLUS_EVAL_SUB`).

## Multi-user access

`ILLUS_ACCESS=open` is the default. Each visitor signs in with their own ChatGPT plan; `ILLUS_ALLOWED_EMAILS` optionally restricts verified emails. `owner` mode preserves the known/claimed owner. Local request caps and the `/api/llm` Edge rate limit have been removed; only an upstream plan-limit pauses that account. See [ADR 0055](../../docs/adr/0055-multi-user-chatgpt-signin.md) and the [setup guide](../../docs/setup-chatgpt-signin.md).
