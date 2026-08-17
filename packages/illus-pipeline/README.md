# @illus/pipeline

Section orchestrator (spec §8, §15): cache → context → plan → extract → validate → (animate, critic) → store, with limits, cancellation and user overrides.

- Owner: W3
- Spec: §8, §15 (decisions in [ADR 0010](../../docs/adr/0010-w3-context-concepts-pipeline-decisions.md))

## Public API

- `createPipeline(deps): Pipeline`
  - `deps`: `repos` (`IllusRepos`), `llm` (`LlmCall` from `@illus/llm`), `prompts` (registry: version and budget per role), `models` (`ILLUS_MODELS_JSON`), `flags`, optional `concepts` (the concept pass, for `indexNow`), `lexical` (W1's MiniSearch index), `templates` (W5), `traceRunner` (W7), `validateAnimation` (W6), `conceptModels` (W8), `critic` (W10), `validate`/`ground` (default: `@illus/core`).
  - `requestSection(sectionId, { force?, instruction?, kindOverride?, planItemId?, keepOthers? }): SectionJob`
  - `requestSelection({ parentSectionId, blockIds }, opts): SectionJob` ("Illustrate selection").
- `SectionJob`: `on(event, cb)` → unsubscribe, `cancel()`, `sectionId` (after `mergedInto`), `finished`. Events: `plan`, `no-visual`, `item-progress` (`queued`, `cached`, `extracting`, `retrying`, `escalating`, `tracing`, `patching`, `animating`, `critic`, `storing`), `item-ready`, `item-failed`, `error`, `done`. The job starts on the next tick, so subscribe right after the call.
- Flow per section: resolve `mergedInto` → wait up to 20 s for `indexNow` (else `partialContext: true`) → plan (cache by plan key) → items by priority (item 1 first, then two at a time) → visual cache by visual key → route (`trace`, concept model, or extract) → validate with W10's `validate()`; over 30% dropped or too few elements → retry once with a `<validator_report>`, then escalate once (roles with an escalation tier) → animate (`animations` flag) → critic (`critic` flag) → store `VisualRecord` (`spec: null`, `models` as `model@effort`).
- Limits: 4 LLM requests in flight, 2 sections generating. Requesting another section cancels the old job's planner call and its queued items; calls already in flight finish and are cached.
- Tracing (§12, [ADR 0037](../../docs/adr/0037-w3-wave3-integration.md)): configure W7's runner without its optional fixer. The pipeline owns up to two `trace-fixer` calls, including request limits, cancellation, token accounting and repaired-translation provenance. Only successful worker scenarios are stored as executed traces. Nontraceable concurrency becomes a validated timeline; unsupported code reports its reason. Persistent execution failures become a grounded animated template from the translator's visualization hint when both feature flags are enabled. Fallback records keep `spec: null` and carry a `trace-simulated` validation warning whose message supplies the UI explanation.
- `validateAnimation(ir, animation, { blocks })` receives exactly the evidence whitelist from the packed context. Pass that block map as W6's `grounding.blocks`; using every indexed block would permit later-chapter evidence. Existing two-argument callbacks remain compatible.
- Helpers: `roleForKind`, `kindEnabled`, `overrideKind`, `reportBlock`, `createLimiter`, `limitLlm`.

## Example

```ts
import { createPipeline } from '@illus/pipeline'

const pipeline = createPipeline({ repos, llm, prompts, models, flags, concepts: conceptPass, lexical })
const job = pipeline.requestSection(sectionId)
job.on('plan', ({ plan }) => store.showSkeletons(plan.items))
job.on('item-ready', ({ planItemId, record }) => store.show(planItemId, record))
job.on('item-failed', ({ planItemId, report }) => store.fail(planItemId, report))
```

## Fixtures and tests

- `test/synthetic.e2e.test.ts`: `synthetic.epub` → W1 index → concept pass → every non-template IR kind (plus template, no-visual, mergedInto, cache hits) through the real `@illus/llm` client in replay mode, on `fixtures/llm/<role>/` for the ten W3 roles.
- `pnpm fixtures:llm` regenerates those fixtures from `test/fixtures/synthetic-calls.ts` (hand-written answers, `"source": "handwritten"`). Re-run it after any change to the structural index, the packer or a W3 prompt version.
- Fixture regeneration replaces only its own profile's outputs. Browser replay artifacts and other profiles in the same role directories are preserved byte for byte; conflicting exact keys fail before any files change. `test/fixture-profiles.test.ts` covers both cases.
- `test/prompts.test.ts`: every W3 prompt file parses, has the six §9 rules, two examples whose outputs pass the schema and quote their input verbatim; the planner carries the §8 kind table verbatim.

## Scripts

- `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm fixtures:llm`
