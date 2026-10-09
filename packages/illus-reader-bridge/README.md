# @illus/reader-bridge

epub.js adapters implementing `ReaderBridge`: location → section, quote → CFI, highlights, selection, theme tokens.

- Owner: W9
- Spec: §14
- Status: implemented; grounding-offset and lifecycle tests run in jsdom, reader flow verified in the app E2E.

## Public API

Everything public is exported from `src/index.ts`. Deep imports are rejected by the boundary lint rules (`tooling/eslint-config`).

`createReaderBridge({bookId,rendition,sections,blocks,themeRoot?})` implements the frozen core ReaderBridge contract plus `dispose()` and `refreshLocation()`. The callbacks return unsubscribe functions. Sections and blocks are read through supplied getters so structural indexing can update without reconnecting the rendition. Location updates debounce 400ms, resolve `mergedInto` and suppress repeated sections. `quoteRange(range,quote)` uses the shared grounding matcher and maps offsets to text nodes inside one block. Script/style/nav and annotation text is excluded.

`quoteToCfi` returns null for a block outside the rendered spine. The caller displays the block CFI first and retries; it never guesses a quote from another block. Evidence and step annotations use separate classes; disposal clears listeners and marks. Theme events follow Flow's root and injected theme style.

## Example

```ts
const bridge = createReaderBridge({ bookId, rendition, sections: () => sections, blocks: () => blocks })
const off = bridge.onLocationChange(({ sectionId }) => requestSection(sectionId))
// On book close:
off()
bridge.dispose()
```

## Scripts

- `pnpm lint` · `pnpm typecheck` · `pnpm test`
