# Reader LLM server

W2's server singleton for `/api/llm` and `/auth/chatgpt/*`. Prompt files are bundled by webpack; the server delegates gateway, auth, sessions, and usage tracking to `@illus/llm/server`.

`getIllusServer()` creates one server per process and retries initialization after a configuration error. `createReaderIllusServer(env, options)` is its testable factory. `resolveReaderFixturesDir(env, cwd?)` resolves disk fixtures without importing app code into a package.

In replay (the default) and record mode, the reader finds the nearest ancestor containing `pnpm-workspace.yaml`, then uses its `fixtures/llm` directory. This works when launched from the repository root, `apps/reader`, or an isolated worktree. `ILLUS_FIXTURES_DIR` takes precedence; relative overrides remain relative to the launch directory. Live mode and injected fixture stores do not require workspace discovery.

```ts
const server = await createReaderIllusServer(
  { ILLUS_LLM_MODE: 'replay', ILLUS_SESSION_SECRET: 'a-test-secret-of-at-least-32-characters' },
  { prompts: createPromptRegistry(PROMPT_FILES) },
)
```

Deployments without the workspace manifest, including the current Docker standalone image, must mount fixtures and set `ILLUS_FIXTURES_DIR` for replay/record mode. Initialization reports this requirement if no workspace is found. Invalid fixture envelopes still fail with their file path; validation is not bypassed.

`pnpm --filter @flow/reader test` includes path discovery, all repository fixture envelopes, a real disk fixture served through the gateway, and fake Responses API record → disk → replay coverage. Tests never call live models or load `.env.local`.
