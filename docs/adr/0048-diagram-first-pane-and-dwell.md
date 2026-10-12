# 0048 — Diagram-first pane, graph by default, and a dwell before generating

- Status: accepted
- Date: 2026-10-11
- Workstream: W9 (pane), W4 (render chrome), W6 (player), W3 (planner and graph extractor prompts)
- Spec sections: §8, §10, §11, §14, §15

## Context

Using the reader on real books showed four problems.

1. **Text crowded out the diagram.** Around one visual, the pane showed a header with the section path, indexing progress and usage caps; a 2–4 sentence overview (up to 120 words); a tab strip of 25-word intents; a 60-word caption; the visual's own title bar with kind and grounding badges; a footer with Evidence, Regenerate, a kind selector, SVG, PNG, Helpful and Not helpful; a token count; and an always-present "Element feedback" list with one "…: This is wrong" button per element. The planner also preferred the `comparison` template, a text table, for any section with variants.
2. **The diagram was small.** `Surface` only ever shrank a diagram to the pane width (scale ≤ 1) and sized its height from the result. A left-to-right graph in a 40% pane was drawn at about 40% scale, with a lot of empty space below it.
3. **Animations did not look like animations.** The player started paused on "Initial state". Its controls and narration had no styling, so they picked up the pane's generic bordered buttons.
4. **Skimming cost requests.** A new illustration started the moment the section changed, so paging through a chapter planned every section passed on the way.

## Decision

**Dwell (W9).** A section with no saved plan waits `preferences.dwellMs` (default 5000 ms; settings offer 0, 2, 5 and 10 s) before `requestVisual`. The pane shows a new `waiting` state with a countdown and an "Illustrate now" button. Every section change cancels the pending dwell and the job for the section the reader left (§15 "navigating away cancels", ADR 0045). A section with a saved plan opens at once, since cached plans make no model calls. Explicit actions (Illustrate now, Retry, Illustrate anyway, Regenerate, Illustrate selection, approving indexing) skip the dwell. The pure helpers `dwellDelay`, `parseDwellMs`, `createDwell` and `dwellSecondsLeft` live in `state.ts`.

**Diagram-first pane (W9, W4, W6).**
- The header is one line: an "Illustrate" eyebrow and the open section's title, with the full path as a tooltip. The progress and usage line appears only while there is no visual; usage stays in settings.
- With a visual on screen, the pane body is a flex column and the visual takes all remaining height. The tab strip shows only with two or more items, as one-line chips with the intent as tooltip.
- The overview and caption move under a collapsed "About this diagram" disclosure below the visual.
- `VisualView` gets `chrome="compact"`. It drops the title bar and footer and puts an Expand button and a "More actions" menu over the top-right corner. The menu holds Helpful/Not helpful, Regenerate, Draw as, Download SVG/PNG, the host's "Report a wrong element…" and token count, and the kind and grounding score. Warning badges (simulated, unverified) stay visible. `chrome="full"` remains the default for other callers.
- `Surface` gets `fill`: it fits the diagram to both axes of its parent. Small diagrams grow up to 1.6×, and wide ones never shrink below 0.6× (the reader pans past the edge). Zoom −, fit and + buttons are added. Without `fill`, nothing changes.
- Expand opens the same DOM as a fixed overlay at 94% of the viewport. Escape or a backdrop click closes it, and the pane's Escape handler skips events the overlay handled.
- `Player` gets `autoPlay`, which plays once when frames arrive (never with reduced motion) and ends on the complete picture. It also gets `highlightWhilePlaying` (the pane passes `false`, so autoplay does not flash marks in the book) and class hooks. The transport uses glyph buttons whose text labels stay as their accessible names.
- The default pane width goes from 40% to 45% (minimum 320 px).

**Graph by default, less text (W3).** Planner prompt 1.2.0:
- `graph` is the default kind.
- Variants and approaches become a `graph` `TB` taxonomy instead of the `comparison` template.
- An algorithm becomes a `trace` when that kind is available, otherwise an animated `graph` flowchart.
- One item usually, two at most.
- Intent ≤ 15 words, caption ≤ 20 words, overview ≤ 40 words.
- Every flow is animated.

Graph extractor 1.2.0: labels ≤ 3 words and sublabels ≤ 5, aim for ≤ 8 nodes, `TB` unless the graph is a single chain of ≤ 4 nodes, and flowcharts for algorithms. The schemas are unchanged (their limits are upper bounds), so saved plans and visuals stay valid.

## Consequences

- Changes §14's pane table (adds `waiting`) and its header bullet (the path becomes a tooltip; usage moves to settings), and §14's 40% default width.
- Planner and graph-extractor prompt versions change, so their replay fixtures are rekeyed with `fixtures:llm` and, from a replay e2e capture, `fixtures:browser`. Plans cached under 1.1.0 stay in IndexedDB and still display. Clear visuals or Regenerate to get the new style.
- `PaneCommands` gains `now()`. `VisualActions` gains `onExpand`, `expanded` and `menuExtra`. `VisualViewProps` gains `chrome`, `SurfaceProps` gains `fill`, and `PlayerProps` gains `autoPlay` and `highlightWhilePlaying`. All are optional except `now`, which only the pane uses.
- The e2e flow waits about 5 s longer on the first section, well inside its 60 s timeouts.
