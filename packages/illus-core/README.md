# @illus/core

The contracts every workstream builds against (spec §5, §9, §11–§13, §16): Zod schemas with `z.infer` types, ids, hashing, feature flags, cache keys, repository interfaces and the interfaces other workstreams implement. DOM-free; runs under plain Node.

- Owner: W0 for `src/{schemas,ids,hash,flags,cache-keys,repos,testing}`; W3 owns `src/compile`, W6 `src/anim`, W10 `src/grounding` and `src/validate` (each fills its own `index.ts`, already re-exported from `src/index.ts`).
- Contracts version: `CONTRACTS_VERSION` (1.2.0, approved; v1.1 and v1.2 changes in the changelog of docs/contracts.md and ADR 0008). Reference: [`docs/contracts.md`](../../docs/contracts.md), regenerated with `pnpm contracts`.
- Changing a public type after the freeze needs an ADR and a version bump (§4).

## Entry points

| Import | Contents |
| --- | --- |
| `@illus/core` | Everything below except testing helpers |
| `@illus/core/flags` | Feature flags only |
| `@illus/core/testing` | Factories, fixture builders, in-memory repositories (tests only) |

Deep imports (`@illus/core/src/...`) are rejected by lint.

## Public API

- **Schemas** (`const X = z.object(...)`, `type X = z.infer<typeof X>`, same name for both):
  - Book: `Block`, `BlockKind`, `SectionNode`, `CrossRef`, `BookMeta`, `BookSummary`, `IndexStatus`.
  - Index: `Evidence`, `SectionIndex`, `SectionIndexOutput`, `SectionIndexRecord`, `IndexerOutput`, `Concept`, `ConceptMerge`, `GlossaryOutput`.
  - Plans: `VisualKind`, `TemplateId`, `PlanItem`, `VisualPlan`, `PlanRecord`.
  - IR: `GraphIR`, `SequenceIR`, `StateIR`, `ClassIR`, `ErIR`, `TemplateIR`, `ChartIR`, `MathIR`, `TimelineIR`, `HtmlIR`, union `IR`, `IrOf<K>`.
  - Animation (§11): `Target`, `Action`, `ACTION_OPS`, `Step`, `AnimationIR`, `FrameState`, `emptyFrame()`.
  - Tracer (§12): `Translation`, `TraceStep`, `ValueRef`, `HeapObj`, `RawTrace`, `Trace`, `ScenarioTrace`, `TraceRecord`.
  - Concept models (§13): `PatchOp`, `PatchOutput`, `Patch`, `ConceptModel`.
  - Quality (§16): `ValidationReport`, `CriticReport`, `criticPasses()`.
  - Records: `VisualRecord`, `LlmLogEntry`, `SettingRecord`.
  - LLM (§9): `RoleName`, `SchemaName`, `SCHEMAS`, `ROLES`, `RoleOutput<R>`, `LlmRequest`, `LlmResponse`, `LlmError`, `ReasoningEffort`, `Tier`.
- **Ports** (implemented elsewhere, injected): `LlmCall` (W2), `ReaderBridge`, `ThemeTokens` (W9), `TraceRunner` (W7), `GroundingFn`, `Validator` (W10), `TemplateSpec`, `TemplateRegistry` (W5), `LayoutGraphFn` (W4).
- **Repositories** (W2 implements with Dexie): `IllusRepos` and one interface per store of §5.
- **Grounding** (W10, §16): `ground` (the `GroundingFn`), `findQuote(text, quote)` (exact, else fuzzy; original offsets; also for W9's `quoteToCfi`), `normalizeText` (NFKC, lowercase, unified quotes/dashes, no soft hyphens, collapsed whitespace, with an offset map) and `originalRange`, `groundingScore`, `FUZZY_THRESHOLD` (0.9), `MIN_QUOTE_WORDS` (3).
- **Validation** (W10, §16 L1–L3): `validate(kind, ir, ctx)` (the `Validator`: Zod parse, grounding with drops and dangling cascade, structural rules and safe auto-fixes, template props and invariants through `ctx.templates`), `needsReextract(report)` (> 30% dropped or too few elements left), `addIssues(report, issues)` (merges animation or render issues and recomputes `ok`), `MAX_DROPPED_SHARE`.
- **Utilities**: `sha256Hex`, `makeBookId`, `makeSectionId`, `parseSectionId`, `makeBlockId`, `parseBlockId`, `sectionContentHash`, `slugify`, `planKey`, `visualKey`, `traceKey`, `resolveFlags`, `parseFlagList`, `DEFAULT_FLAGS`.

## Example

```ts
import { GraphIR, planKey, resolveFlags } from '@illus/core'
import { createMemoryRepos, make } from '@illus/core/testing'

const ir = GraphIR.parse(modelOutput) // throws on invalid model output
const key = await planKey({ bookId, sectionId, contentHash, contextVersion: CONTEXT_VERSION, planner: { promptVersion, model, effort } })
const flags = resolveFlags(await repos.settings.get('flags'))

// in tests
const repos = createMemoryRepos()
await repos.visuals.put(make.visualRecord({ sectionId }))
```

### Grounding and validation

```ts
import { ground, validate, needsReextract } from '@illus/core'

const blocks = new Map(usedBlocks.map((b) => [b.blockId, b])) // only the context's usedBlockIds
const { ir, report } = validate('graph', modelOutput, { blocks, ground, aliases, templates })
if (needsReextract(report)) {/* re-run the extractor once with the report attached (§8) */}
else if (!report.ok) {/* one `repair` call with report.issues (§16 L3) */}
```

Issue codes: L2 `quote-not-found` and `dangling` (element dropped, warning, `autoFixed`), `half-grounded` (warning), `template-element-ungrounded` (error); L3 errors `duplicate-id`, `duplicate-label`, `*-endpoint-missing`, `isolated-nodes`, `group-cycle`, `too-few-elements`, `initial-missing`, `transition-event-missing`, `log-domain`, `duplicate-series`, `source-block-missing`, `lane-missing`, `message-target-missing`, `at-not-increasing`, `template-unknown`, `template-props`, `template-invariant`; L3 warnings `unreachable-state`, `template-unchecked`, `no-evidence`; safe auto-fixes `group-missing`, `participant-unused`, `final-missing`, `events-reordered`. Decisions behind these choices: ADR 0006.

## Conventions

- Relative imports carry the `.ts` extension (`allowImportingTsExtensions`, `erasableSyntaxOnly`), so modules also run under Node's type stripping (`node scripts/contracts.ts`).
- Schemas never use `.default()`, so input and output types are identical.
- Factories in `@illus/core/testing` parse their result; every evidence quote they produce is verbatim from the small fixture book (`SMALL_BOOK_BLOCKS`).

## Scripts

- `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm contracts` (regenerates `docs/contracts.md`)
