# 0049 — Graph diagram language and AWS architecture icons

- Status: accepted
- Date: 2026-10-12
- Workstream: W0 (schemas, icon catalog), W3 (parser, pipeline, extractor.graph prompt, fixtures), W4 (graph renderer, icon assets)
- Spec sections: §2 D8, §5, §8, §9, §10, §16, §19

## Context

Eraser.io's diagrams read well at a glance: each component carries an icon, and Eraser's "diagram as code" is a few short lines (`Name [icon: database]`, `Group { … }`, `A > B: label`) that a model writes quickly. Our graph extractor wrote `GraphIR` JSON instead. Every node and edge repeated `"id"`, `"shape"`, `"style"` and a full `{ "blockId": "<64-character section id>#b0", "quote": … }` object, and nodes drew no pictures.

Two ways to follow Eraser were considered:

- **Call Eraser's prompt-to-diagram API.** Rejected. Book text would leave the ChatGPT Plus setup (private books must not), it needs a paid Eraser plan, and the diagram would come back as a picture. That loses the evidence links, animations and concept models, and breaks D8 and the §16 grounding checks.
- **Copy the approach.** Accepted. The model writes a small Eraser-style language with a block ref and a verbatim quote on every line. A deterministic parser turns it into `GraphIR`, which goes through the same validation and rendering as before.

D8 says models emit Zod-validated IR, not diagram text. The diagram language is a text IR: it maps one-to-one onto `GraphIR` and is never handed to a drawing engine, so the intent of D8 still holds (no SVG, no Mermaid, no positions, nothing executable). This ADR records the change in the letter of D8.

## Decision

**Language (W3, `parseGraphSource` in `@illus/core/compile`).** One statement per line:

```
title Log replication
direction down                                       (down | right; TB, LR, up, left accepted)
Client [icon: user, shape: actor] @b0 "The leader accepts client requests"
Cluster [icon: servers, color: blue] @b1 "…" {      (a group; nodes inside belong to it; groups nest)
  Follower [sublabel: "copies the log"] @b1 "…"
}
Client > Leader: request @b0 "The leader accepts client requests"
Follower --> Leader: success flag @b2 "…"            (--> dashed; < and <-- reverse the arrow)
```

- Evidence `@<ref> "<quote>"` ends every line. `ref` is a block id or its `#bN` suffix. When a suffix matches blocks from more than one section, the block whose text holds the quote wins.
- Ids are slugs of the names (unique, numbered on collision); edges are `e1…`.
- A node with no quote borrows its first connection's evidence. A connection to an undeclared name creates a box grounded by that connection. A group with no quote borrows its first member's. Each of these is a warning.
- Unknown icons, colours, shapes and attributes are dropped with warnings. Shape aliases (`database`, `diamond`, `person`, …) are accepted.
- Statement-level problems are errors with line numbers: unknown block, missing evidence, a connection to a group, `-`/`<>` connectors, bad syntax, unclosed groups. The parser never throws.

**Schemas (W0).**
- `GraphNode` and `GraphGroup` gain optional `icon` (a slug; unknown names are not a schema error, so a catalog change never invalidates stored visuals) and `color` (`blue | green | orange | red | purple | gray`).
- New `GraphSource = { source: string ≤ 8000 }` model-output schema.
- `extractor.graph` may return `GraphSource` (default) or `GraphIR`.
- `GRAPH_ICONS` in `@illus/core` is the icon catalog: 43 generic names (user, client, server, database, logs, queue-like streams, lock, …) and 43 `aws-*` service names.

**Pipeline (W3).**
- `graph` items request `GraphSource`. `validateGraphSource` parses the source, runs the usual `validate('graph', …)`, and folds the parse issues into the report.
- A statement that failed to parse is dropped like an ungrounded element: it counts in `dropped`, stays as an auto-fixed warning, and appears in the `<validator_report>` of a retry. So the 30% re-extract rule applies to it.
- A source with no usable node is an error.
- `repair` and the animator still read and write `GraphIR` JSON.

**Prompt (W3).** `extractor.graph` 2.0.0 describes the language, lists every icon name (a test keeps the list complete), and has two worked examples whose sources must parse without issues against their own blocks.

**Icons (W4).**
- `packages/illus-render/scripts/aws-icons.ts` turns the official AWS Architecture Icons package (release 07312026, downloaded from aws.amazon.com/architecture/icons) into `src/graph/icons.generated.ts`. It uses the 48 px "General" resource icons (Light) and 48 px service icons.
- The script keeps plain shapes only: it refuses scripts, styles, links and images, removes ids and titles, turns `<rect>` into `<path>`, and rounds coordinates. The one-colour generic icons draw in `currentColor`, so they follow the theme.
- Nodes draw a 28 px icon above the label (`ICON_BAND` of height); an actor with an icon is a box without the stick figure. Decisions and notes never draw icons. Groups draw a 16 px icon before their label.
- `data-color` sets a stroke and a tinted fill; frame tones still win. Tone rules skip `.illus-icon *`.

**No feature flag.** A role has one prompt version at a time, so the output format cannot be flagged without a second role. Rollback is reverting the prompt to 1.2.0 and the `graph` entry of the pipeline's `EXTRACTOR` map; stored visuals are `GraphIR` either way. This is the exception to golden rule 8 for this change.

## Consequences

- §2 D8, §8 stage 2 and §10 (graph) read differently, as above; §9's `extractor.graph` schema is now `GraphSource`.
- `@illus/core` contracts change additively: `GraphIcon`, `GraphColor`, `GraphSource`, `GRAPH_ICONS`, `parseGraphSource`, and the optional `icon`/`color` fields. `docs/contracts.md` is regenerated.
- The `extractor.graph` replay fixtures are rekeyed (`fixtures:llm`); the handwritten graph answers in `synthetic-calls.ts` are written in the language. Browser fixtures had no graph extractions; `browser-replay.test.ts` now validates `GraphSource` answers when a capture adds them.
- Stored visuals and plans stay valid (the new fields are optional). Visual keys change because the prompt version enters them, so graphs are re-extracted on next view.
- The AWS icons are used under AWS's terms for the package ("We allow customers and partners to use these toolkits and assets to create architecture diagrams"); recorded in `docs/dependencies.md`. Bundle cost is about 165 KB of source (≈ 45 KB gzipped) in `@illus/render`.
- The output is shorter: the extractor writes one line per element instead of a JSON object, and short block refs replace full block ids.
