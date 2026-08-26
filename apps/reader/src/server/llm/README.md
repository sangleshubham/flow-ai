# Reader LLM server

W2's server singleton for `/api/llm` and `/auth/chatgpt/*`. Prompt files are bundled by webpack; the server delegates gateway, auth, sessions, and usage tracking to `@illus/llm/server`.

`getIllusServer()` creates one server per process and retries initialization after a configuration error. `createReaderIllusServer(env, options)` is its testable factory. `resolveReaderFixturesDir(env, cwd?)` resolves disk fixtures without importing app code into a package.

The factory supplies W5's `templateRegistry` through the server-safe public `@illus/render/templates` entry ([ADR 0040](../../../../../docs/adr/0040-w4-server-template-entry.md)). This is a static schema capability: the existing gateway validates the session and role/schema request, then selects the props schema using the required `templateId`. Malformed props and an answer for a different template return `schema`. The browser's `templates` flag continues to gate generation and rendering; no extra server flag, browser database, session manager, or usage tracker is introduced. `options.templates` remains available for explicit registry injection in tests or alternate hosts.

In replay (the default) and record mode, the reader finds the nearest ancestor containing `pnpm-workspace.yaml`, then uses its `fixtures/llm` directory. This works when launched from the repository root, `apps/reader`, or an isolated worktree. `ILLUS_FIXTURES_DIR` takes precedence; relative overrides remain relative to the launch directory. Live mode and injected fixture stores do not require workspace discovery.

```ts
const server = await createReaderIllusServer(
  {
    ILLUS_LLM_MODE: 'replay',
    ILLUS_SESSION_SECRET: 'a-test-secret-of-at-least-32-characters',
  },
  { prompts: createPromptRegistry(PROMPT_FILES) },
)
```

Deployments without the workspace manifest, including the current Docker standalone image, must mount fixtures and set `ILLUS_FIXTURES_DIR` for replay/record mode. Initialization reports this requirement if no workspace is found. Invalid fixture envelopes still fail with their file path; validation is not bypassed.

`pnpm --filter @flow/reader test` includes path discovery, all repository fixture envelopes, a real disk fixture served through the gateway, and fake Responses API record → disk → replay coverage. Template tests replay all 16 W5 examples, reject malformed props and template mismatches, preserve request/session guards, and rekey the repository template answer with a known test context; that answer currently fails W5's `array` schema and is asserted as a `schema` rejection until W3 updates it ([ADR 0041](../../../../../docs/adr/0041-w2-stale-template-fixture.md)). Tests never call live models or load `.env.local`.
