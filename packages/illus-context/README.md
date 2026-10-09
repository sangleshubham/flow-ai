# @illus/context

DOM-free context packer (spec §7): deterministic slot packing into a cacheable `prefix` and a per-call `body`.

- Owner: W3
- Spec: §7

## Public API

- `packContext(input): Promise<PackedContext>`: fills the eight §7 slots in priority order (`bookPrefix`, `current`, `referenced`, `definitions`, `path`, `previous`, `conceptModel`, `lexicalFallback`) under their caps (`SLOT_CAPS`) and the role's `budgetTokens`. Returns `{ prefix, body, usedBlockIds, dropped, tokens }`.
  - `current` is never truncated; any other slot that loses an item to its cap or the budget is listed in `dropped`.
  - Reading-position gating: concepts with `firstOrdinal` after the section, definitions from later sections and cross-references to later sections never enter.
  - Lexical fallback runs only when a non-code block has a back-reference phrase ("as we saw", "recall", "earlier", "previous chapter", "the approach above") and no resolved cross-reference; it queries `repo.lexical` (W1's `buildLexicalIndex`) with the sentence's content words, earlier ordinals only, top 3.
  - Byte-identical output for the same inputs, whatever order the store returns records in (tested).
  - `planItem` is appended as `<plan_item>`; `synthetic` packs a selection section that is not in the store.
- `ContextRepo`: the read-only store view it needs; `IllusRepos` plus an optional `lexical` satisfies it.
- `CONTEXT_VERSION`: part of the plan cache key; bump it when the packed format changes.
- Format helpers shared with `@illus/concepts`: `renderSection`, `renderBlock`, `escapeText` (escapes only a `<` that could open a tag, so code stays quotable), `estimateTokens` (`ceil(chars / 3.6)`), `clipTokens`.

Deliberate simplifications: a definition is its block clipped to 150 tokens around the quote (no ±1 neighbouring paragraph); the default concept-model state is the model's earlier patches, until W8 passes `conceptModelState`.

## Example

```ts
import { packContext } from '@illus/context'

const { prefix, body, usedBlockIds } = await packContext({
  role: 'planner', sectionId, budgetTokens: 12_000,
  repo: { ...repos, lexical: buildLexicalIndex(blocks, sections) },
})
```

## Scripts

- `pnpm lint` · `pnpm typecheck` · `pnpm test`
