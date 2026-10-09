// Public API of @illus/llm (browser-safe; spec §9 "Client"). The Node-only gateway, providers and
// Sign in with ChatGPT live in `@illus/llm/server` (ADR 0006).
export { createLlmClient, httpTransport, recordTransport, replayResponse, replayTransport, transportFor } from './client.ts'
export type { LlmClientOptions, LlmTransport } from './client.ts'
export { Fixture, LlmMode, fixtureFromResponse, fixtureKey, keyOfFixture, llmModeFrom, memoryFixtures } from './fixtures.ts'
export type { FixtureKeyInput, FixtureStore } from './fixtures.ts'
export { outputSchema, stripAddedNulls } from './json-schema.ts'
export type { JsonSchema, OutputSchema } from './json-schema.ts'
export { DEFAULT_MODELS, ModelsConfig, loadModelsConfig, resolveRoute } from './models.ts'
export type { ModelEntry, ModelRun, Route } from './models.ts'
export { createPromptRegistry, parsePromptFile } from './prompts.ts'
export type { PromptFile, PromptRegistry } from './prompts.ts'
export { ProviderError } from './provider.ts'
export type { LlmProvider, ProviderErrorKind, ProviderId, ProviderRequest, ProviderResult, StructuredMode } from './provider.ts'
