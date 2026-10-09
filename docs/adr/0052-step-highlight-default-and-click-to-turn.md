# 0052 — Step highlighting defaults on, is remembered, and clicks turn to the passage

- Status: accepted
- Date: 2026-10-16
- Workstream: W9
- Spec sections: §11, §14

## Context

The [§11 player](../spec.md#11-step-animations-timeline-dsl-and-player) sends evidence for the current animation step. [ADR 0048](0048-diagram-first-pane-and-dwell.md) made the pane pass `highlightWhilePlaying={false}` to avoid marking passages during autoplay. This meant users had to opt in on every illustration, and the pane's separate focus/hover preference also suppressed step highlights.

An evidence quote can resolve to a CFI in a loaded chapter while its passage is off screen. The existing runtime turned pages only when quote resolution failed, so clicking narration could mark a passage without showing it.

## Decision

Supersede ADR 0048's `highlightWhilePlaying={false}` decision. Store `highlightSteps` with the pane's existing preferences, defaulting to `true` for new and previously saved settings. The Player checkbox and the illustration settings checkbox update the same preference. The Player follows the current step while paused as well as during playback, using its controlled checkbox API.

Step highlights are independent of `autoHighlight`, which continues to control focus and hover evidence. Playback and stepping can mark passages but never turn the book's page. Clicking narration or other evidence explicitly scrolls to the resolved quote CFI; if none is available, it scrolls to the source block and resolves the quote again. Ignore superseded or closed-book requests before navigation and after asynchronous work.

Leave concept-model scrubber props unchanged; their Player retains its existing default highlight option.

## Consequences

Users can opt out once and keep that choice across illustrations and sessions. Previously saved preferences without the field enable step highlights. A paused animation can retain a step mark; an explicit narration click can move the book, while playback cannot.

Runtime tests cover preference migration and reload, step highlighting with hover highlighting disabled, click navigation to found and unloaded quotes, and asynchronous requests superseded by a newer click or closing the book. The Player's tests cover its controlled checkbox behavior.
