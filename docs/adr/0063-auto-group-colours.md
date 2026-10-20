# 0063 — Automatic colours for graph groups

- Status: accepted
- Date: 2026-10-21
- Workstream: W4
- Spec sections: §8, §10

## Context

The optional group and node colours introduced by [ADR 0049](0049-graph-diagram-language-and-icons.md)
are usually omitted by the extractor. In [GraphView](../../packages/illus-render/src/graph/GraphView.tsx),
this left regions as identical grey dashed boxes. The existing fixed accent hex values and
transparent fills also made label contrast depend on the active Flow surface and nested regions.
§10 requires themed renderer tokens and standalone SVG/PNG export; this decision extends the
renderer-local token set without changing `ThemeTokens`, the IR schema, or prompts.

## Decision

- Resolve presentation colours with the DOM-free `assignGroupColors` function, without mutating IR.
  Use the ordered palette `blue`, `green`, `orange`, `red`, `purple`, `gray`. Reserve explicit group
  and node colours before assigning any defaults, including explicit colours appearing later in IR.
- Resolve parents before children and earlier siblings before later siblings, even when a child
  precedes its parent in IR. An automatic group excludes its parent's colour and colours already
  assigned or explicitly reserved among its siblings. Of the remaining colours, prefer those not
  explicitly used anywhere in the graph, then those not yet used anywhere. Break ties by palette
  order. When siblings exhaust eligible colours, reuse palette colours while excluding the parent.
  Explicit colours always win, including authored sibling or parent/child collisions. There are six
  distinct root colours and five distinct automatic child colours when excluding a parent's colour.
- A node with no explicit colour inherits its immediate group's resolved colour. Ungrouped nodes
  retain their existing appearance; edges retain their existing styles. Nodes added by animation
  have no IR group membership and retain their existing appearance.
- Define light and dark palette entries with opaque group fills, subtler node fills, and matching
  label/border ink. `themeVars` emits `--illus-<colour>-fill`, `--illus-<colour>-node-fill`, and
  `--illus-<colour>-ink` using `ThemeTokens.dark`. Flow's existing `watchFlowTheme` observes the
  HTML `dark` class and updates these variables through the normal theme path.
- Use palette ink for group labels, coloured node labels and sublabels. Strengthen group borders
  to 1.75px and preserve dashed outlines and animation-tone overrides. Opaque fills prevent nested
  regions from blending into untested backgrounds. Unit tests compute WCAG sRGB contrast and
  require at least 4.5:1 for every ink against both of its fills, in both modes.
- Keep colours in exports through the existing `exportSvg` path, which embeds `themeVars` and
  `SVG_CSS`; PNG rasterises that same SVG. No external document theme is needed by either export.
  Set the SVG namespace declaration with `setAttributeNS` so XML serialization does not duplicate it.
- This updates an existing graph presentation behaviour; it introduces no new feature flag or
  core contract.

## Consequences

Existing cached graphs gain distinct regions when rendered, without re-extraction or cache migration.
Colours are visual grouping aids, not semantic claims or new evidence. Palette exhaustion can repeat
colours, and explicit author choices can deliberately repeat them. Labels and group boundaries remain
available to distinguish those regions.

Tests cover deterministic assignment, explicit reservations, sibling uniqueness, forward parents,
nesting, exhaustion, node inheritance, both palette modes and AA contrast. Browser tests check actual
SVG fills, borders, labels, inherited node tints, a live Flow theme toggle, unchanged edge styling,
and sampled group-fill pixels in standalone SVG and PNG exports.

Verification: renderer unit tests, typecheck and lint pass. On Linux the core Playwright suite passes, including group-colors.e2e.ts (graph-scene-hooks.e2e.ts was updated for the new palette inks). Only darwin screenshot baselines are committed. The graph, graph-shapes, graph-frame and graph-concept baselines (light and dark) now show tinted groups and must be regenerated on macOS with `pnpm --filter @illus/render exec playwright test test/e2e/visual.e2e.ts --update-snapshots`.
