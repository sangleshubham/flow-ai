# 0036 — Reader integration uses Flow's fixed split panel

- Status: accepted
- Date: 2026-10-09
- Workstream: W9
- Spec sections: §8, §14–17, §22

## Context

The Flow audit confirms there is no pane registry. The new pane requires small changes outside W9's directories to connect it to the existing shell, settings, package dependencies, global formula styles, transpilation and scripted-content setting.

## Decision

Use the audited fixed right-hand SplitView panel, with a mobile overlay. The orchestrator explicitly allocated the narrow wiring changes to W9. A visible Illustrate toggle enables the persisted `illustrateEnabled` setting (default false); closing the panel pauses work. Explicit consent to concept indexing shows its estimated usage. Existing feature defaults remain false. Cached visuals continue to work offline and after sign-in/limit errors. Feedback persists on VisualRecord and error reports in settings until W10's export tooling consumes them.

## Consequences

W9 owns the app Layout/settings wiring, dependencies and transpile additions, global KaTeX stylesheet, production reader E2E and `allowScriptedContent: false` change. Auth and security headers remain W11-owned; server and fixtures changes are requested from their owners. The pure bridge maps grounding offsets to DOM ranges within each block and resolves merged sections. W6/W7 player integrations are added only after their public APIs land.

Next 12 requires node-style TypeScript resolution; app-only paths select vega-embed's published declaration and include W5's existing d3 ambient declaration without adding dependencies. Renderer UI is browser-only (avoiding Vega's node canvas import during SSR). The documented Next12 `swcMinify` option handles class static blocks in current Mermaid/Vega dependencies that the bundled legacy Terser cannot parse. No CSP weakening is required.
