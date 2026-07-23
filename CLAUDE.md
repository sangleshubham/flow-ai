# AI Illustrated Reader (Flow fork)

A personal EPUB reader for technical books. A right-hand pane explains the current section with grounded diagrams, step animations, executed code traces and concept diagrams that grow across sections. Model calls run on Shubham's ChatGPT Plus plan through Sign in with ChatGPT.

## Source of truth

- Spec: `docs/spec.md` (Markdown export of the "AI Illustrated Reader — v1 Spec" doc). Section numbers like §9 refer to it.
- When code and spec disagree, write an ADR in `docs/adr/` (copy `0000-template.md`). Never diverge silently.
- Flow internals: `docs/flow-audit.md` (written by W0). Read it before touching `apps/reader`.
- Build progress: `docs/build-log.md` (written only by the orchestrator).

## How the build runs

- `/build-reader` starts the orchestrator. It spawns the workstream subagents in `.claude/agents/` wave by wave (spec §20 and §21).
- Each subagent works in its own git worktree and branch. Only the orchestrator merges into `main`.
- Subagents never spawn other subagents.

## Ownership map

Edit only what your workstream owns. Need a change elsewhere? Write an ADR or a contract-change request in `docs/adr/` and mention it in your final report.

| Path | Owner |
| --- | --- |
| `packages/illus-core/src/{schemas,ids,hash,flags,cache-keys,repos,testing}` | W0 |
| `packages/illus-core/src/compile` | W3 |
| `packages/illus-core/src/anim` | W6 |
| `packages/illus-core/src/{grounding,validate}` | W10 |
| `packages/illus-book-index` | W1 |
| `packages/illus-store`, `packages/illus-llm`, `apps/reader/src/server/{llm,auth,usage}`, the `/api/llm` and `/auth/chatgpt/*` routes | W2 |
| `packages/illus-concepts` (except `src/models`), `packages/illus-context`, `packages/illus-pipeline` | W3 |
| `packages/illus-concepts/src/models` | W8 |
| `packages/illus-render` (except `src/templates`, `src/check`), `apps/reader/public/illus-sandbox.html` | W4 |
| `packages/illus-render/src/templates` | W5 |
| `packages/illus-render/src/check` | W10 |
| `packages/illus-anim` | W6 |
| `packages/illus-tracer`, `fixtures/traces` | W7 |
| `packages/illus-reader-bridge`, `apps/reader/src/illustrate` | W9 |
| `apps/reader` middleware, `/login`, security headers in `next.config`, `Dockerfile`, `docker-compose.yml`, `docs/deploy.md` | W11 |
| `evals/` | W10 |
| `fixtures/books`, `fixtures/scripts`, CI config, lint config, `docs/dependencies.md`, `docs/contracts.md` | W0 |
| `docs/prompts/<role>.md` and `fixtures/llm/<role>/` | The role's owner (below) |
| `docs/adr/` | Anyone, new files only |

Prompt owners: `indexer`, `glossary`, `book-summary`, `planner`, `extractor.*` → W3 · `animator` → W6 · `translator`, `trace-fixer` → W7 · `patcher` → W8 · `critic`, `repair` → W10 · `html-fallback` → W4.

## Golden rules

1. Models never emit SVG, Mermaid text or animation code. They emit Zod-validated IR; compilers and renderers do the rest (§2 D8).
2. Every model output passes a Zod schema. Every IR element carries verbatim evidence (§8, §16).
3. Pure logic (schemas, compilers, reducers, validators, packers) is DOM-free and written test-first.
4. Dependencies are exact-pinned, at least 14 days old, and recorded in `docs/dependencies.md`. Anything not in §19 needs an ADR.
5. No package imports from `apps/reader`. No deep imports: a package's public API is its `src/index.ts`.
6. `ILLUS_LLM_MODE=replay` by default. Subagents never make live model calls. Hand-written LLM fixtures are allowed but must include `"source": "handwritten"`.
7. Never commit secrets, `.env.local`, private books, or fixtures containing text from private books.
8. New work merges behind its feature flag in `@illus/core/flags` until its "done when" criterion passes.
9. Always send `reasoning.effort` explicitly; only `low`, `medium`, `high` are allowed in v1 (§9).

## Commands

W0 adds any of these that Flow does not already have.

- `pnpm i` · `pnpm dev`
- `pnpm turbo run lint typecheck test` (the merge gate)
- `pnpm e2e` (Playwright, replay mode)
- `pnpm eval` (live model calls; Shubham runs it, never a subagent)

## Commits

- Prefix messages with the workstream: `W3: add context packer`.
- One logical change per commit, with its tests in the same commit.
