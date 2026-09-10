# Illustrate integration (W9)

The fixed right-hand Flow panel connects structural indexing, explicit concept-index approval, the section pipeline, saved visuals and evidence highlights. Material You tokens, a mobile overlay, keyboard tabs, Alt+I (including book iframe focus), pinning and all ten pane states are included. The visible Illustrate toggle enables local persisted preferences; defaults keep it closed and all existing feature flags off. A clicked evidence mark stays until another evidence is shown; hover and focus marks are transient and only appear with auto-highlight on (`evidenceAction` in `state.ts`). The pane reads `/auth/chatgpt/status`; `configured: false` shows "ChatGPT sign-in is not configured" instead of the sign-in link. Concept indexing asks for confirmation only above `indexConfirmThresholdTokens` (default 200,000, ADR 0010).

`IllustratePane` is mounted as the last Layout SplitView child and loaded only in the browser. `IllustrateSettings` adds preferences/account/usage and book cache actions to Flow settings. `PaneContent` is presentational; `bindJob` subscribes synchronously and ignores stale job events. `runtime` owns the IndexedDB repositories, concept pass, bridge and pipeline lifecycle. `RecordView` draws validated cached IR; with the `conceptModels` flag, items with a concept model are drawn from the stored model instead (`ConceptModelView`: W8's `sectionView`, `conceptLayoutGraph`, toggles and `EvolutionScrubber`; positions saved with `withLayout`, ADR 0044). W10's `reviewHook` (L4 render checks, L5 critic, repair) runs as the pipeline's `review` only while the `critic` flag is on (`whenCritic`); `QualityWarning` shows the warning badge for a failing critic report or remaining render warnings (ADR 0043). The pipeline's `catching-up` stage shows "Catching up the concept model: N sections" under the generating item. `RecordView` also, persists layout and feedback, exposes kind override/regeneration and reports wrong elements using mouse or keyboard. Book text never enters an execution context; Flow sets scripted content false.

Settings live under `illustratePreferences` in `illus.settings`; concept-index approval is per book. Error reports are local settings rows; votes and element reports use the frozen VisualRecord contract for W10 feedback export. Cache imports use W2's atomic schema-validated importer.

```tsx
// Layout's browser-only SplitView child:
<IllustratePane />
// Existing settings page:
<IllustrateSettings />
```

Verify with `pnpm turbo run lint typecheck test --filter=@flow/reader --filter=@illus/reader-bridge` and `pnpm --filter @flow/reader e2e`. The production replay E2E imports only `fixtures/books/synthetic.epub`; request captures and screenshots are test artifacts. No live model calls or credentials are needed.
