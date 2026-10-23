<h1 align="center">Flow AI: an illustrated EPUB reader</h1>

<p align="center">A browser EPUB reader for technical books. Next to the book, a side pane explains the section you are reading with diagrams, step animations and executed code traces, and every part of it links back to the text it came from.</p>

<p align="center">
  Built on <a href="https://github.com/pacexy/flow">Flow</a> · Self-hosted · Model calls run on your own ChatGPT plan
</p>

---

## Contents

- [Demo](#demo)
- [Relationship to Flow](#relationship-to-flow)
- [What Flow AI adds](#what-flow-ai-adds)
- [How it works](#how-it-works)
- [Install](#install)
- [Start the reader](#start-the-reader)
- [Self-hosting with Docker](#self-hosting-with-docker)
- [Configuration](#configuration)
- [Development](#development)
- [Repository layout](#repository-layout)
- [Further documentation](#further-documentation)
- [License and credits](#license-and-credits)

## Demo

<!--
  To add the demo video: edit this file on github.com, drag the .mp4 or .mov file into the editor
  just below this comment, and commit. GitHub uploads it and puts a
  https://github.com/user-attachments/assets/... link here, which plays inline. Files up to 10 MB
  work on the free plan, so trim the recording or lower its resolution if it is larger.
  Then delete the placeholder line below.
-->

> 🎬 opening a book, the Illustrate pane, diagrams and animations, evidence highlights, and a whole-book run._
> [screen-capture (1).webm](https://github.com/user-attachments/assets/86898538-f231-4503-9acd-d1fa8e9fe271)


## Relationship to Flow

Flow AI is a fork of [**Flow**](https://github.com/pacexy/flow) by [pacexy](https://github.com/pacexy), a free, open-source, browser-based EPUB reader (Next.js, React, epub.js). Everything Flow does still works here:

- Grid layout with several books open side by side
- Search in a book
- Share or download a book with a link
- Image preview
- Custom typography and themes
- Highlights and annotations
- Data export
- Cloud storage

The original Flow is at [github.com/pacexy/flow](https://github.com/pacexy/flow) and [flowoss.com](https://flowoss.com). This repository ([sangleshubham/flow-ai](https://github.com/sangleshubham/flow-ai)) keeps Flow's reader and adds an AI illustration layer on top. Flow's marketing site (`apps/website`) has been removed ([ADR 0042](docs/adr/0042-w0-post-wave3-port.md)).

## What Flow AI adds

### The Illustrate pane

A right-hand pane (toggle with **Alt+I**) that follows your reading position. When you stay on a section for a moment (2 seconds by default), it picks the right kind of visual for that section, or tells you why the section doesn't need one.

| Visual family            | Examples                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Graph diagrams           | Architectures, data flows, dependency graphs, laid out by ELK with icons and colour groups                                                    |
| Mermaid diagrams         | Sequence, state, class and ER diagrams                                                                                                        |
| Data-structure templates | Array, stack, queue, linked list, tree, hash table, graph, grid, bits, cache, call tree, memory, layers, pipeline, set operations, comparison |
| Charts                   | Vega-Lite charts built from numbers in the text                                                                                               |
| Math                     | KaTeX rendering of formulas from the section                                                                                                  |
| Timelines                | Ordered events and phases                                                                                                                     |

### Grounded in the book

- Every node, edge, step and narration line carries a **verbatim quote** from the book. Click any element to jump to and highlight the passage it came from.
- Models never draw anything. They return structured, schema-validated data, and deterministic compilers and renderers turn it into the picture. Nothing the model writes is ever run as SVG, Mermaid source or animation code.

### Step animations

- Graphs and templates can play as step-by-step animations with play, pause, step, scrub and speed controls.
- A scene player for multi-step graph animations (beta, behind a flag).

### Executed code traces (beta)

- Code from the book, in any language, is translated to Python and **actually run** in Pyodide inside a locked-down Web Worker (no network, no file system, hard timeout).
- You step through the recorded trace next to the original code. Concurrency code runs on a simulated timeline and is labelled as such.

### Concept diagrams that grow (beta)

- A concept that spans several sections gets one persistent diagram, which is patched section by section. New parts are highlighted, and an evolution scrubber shows how it grew.

### Whole-book illustration

- An **Illustrate whole book** button, after a confirmation card with a rough request estimate, generates visuals for every section in reading order and caches them.
- The section you are reading always goes first. The run pauses when you close the book and resumes when you reopen it. If your ChatGPT plan limit is hit, it pauses until you click Resume.
- A progress panel shows the section list, an ETA and a stop button.
- While a section regenerates, the earlier version stays visible.

### Also included

- **Illustrate selection**: select any passage and illustrate just that.
- **Book index**: a one-time background pass per book builds the section tree, cross-references, a glossary and per-section summaries, so each visual has the right context.
- **Quality checks** (beta): render checks, an AI critic and automatic repair, with a warning badge when a visual may be wrong.
- **Feedback**: vote on visuals, report wrong elements, override the visual kind and regenerate.
- **Local cache**: generated visuals live in the browser (IndexedDB). Repeat visits are instant, and the cache can be exported and imported as JSON.
- **Sign in with ChatGPT**: model calls run on each user's own ChatGPT plan. There is no API key, and OAuth tokens stay encrypted on the server.
- **Security**: a login gate, an optional email allowlist or single-owner mode, CSP and security headers, and a Tailscale-only VPS deployment guide.

### Feature flags

Some features are still in beta and are off by default. Turn them on in **Settings → Features**.

| Flag              | Default | Feature                                    |
| ----------------- | ------- | ------------------------------------------ |
| `templates`       | on      | Data-structure templates                   |
| `animations`      | on      | Step animations                            |
| `wholeBook`       | on      | Illustrate whole book                      |
| `sceneAnimations` | off     | Scene player for graph animations          |
| `tracer`          | off     | Executed code traces                       |
| `conceptModels`   | off     | Concept diagrams that grow across sections |
| `critic`          | off     | Render checks, AI critic and repair        |
| `htmlFallback`    | off     | Sandboxed HTML fallback visual             |

## How it works

Almost everything runs in the browser. A thin Next.js server handles Sign in with ChatGPT, holds the tokens and proxies model calls.

```
 reading position ──▶ pipeline ──▶ cache hit? ──yes──▶ render
                        │
                        no
                        ▼
              context packer (summaries, glossary, section text)
                        ▼
              planner: which visual, if any?          ─┐
                        ▼                              │  model calls via /api/llm
              extractor: grounded IR (JSON + quotes)  ─┘  (Next.js server → ChatGPT plan)
                        ▼
              validate (Zod schema + quote grounding)
                        ▼
              compile IR → ELK / Mermaid / template / Vega-Lite / KaTeX spec
                        ▼
              render + animate ──▶ store in IndexedDB
```

The full design is in [`docs/spec.md`](docs/spec.md).

## Install

### Prerequisites

- [Node.js](https://nodejs.org) **24 or newer** (the server uses `node:sqlite`)
- [pnpm](https://pnpm.io/installation) **10.34.5** (pinned in `package.json`; `corepack enable` picks it up)
- [Git](https://git-scm.com/downloads)
- A ChatGPT account, to generate visuals for your own books
- [Docker](https://docs.docker.com/get-docker/), optional, for self-hosting

### Clone and install

```bash
git clone https://github.com/sangleshubham/flow-ai.git
cd flow-ai
pnpm i
```

### Configure

```bash
cp apps/reader/.env.local.example apps/reader/.env.local
openssl rand -base64 32   # → ILLUS_TOKEN_ENC_KEY
openssl rand -base64 48   # → ILLUS_SESSION_SECRET
```

Put the two generated values into `apps/reader/.env.local`. To generate visuals for real books, also set:

```dotenv
ILLUS_LLM_MODE=live
ILLUS_PUBLIC_URL=http://127.0.0.1:7127
ILLUS_ACCESS=open
ILLUS_DATA_DIR=./.illus-data
```

`.env.local` is git-ignored. Never commit it.

> **Replay vs live.** `ILLUS_LLM_MODE` defaults to `replay`, which serves recorded responses from `fixtures/llm/` and makes no model calls. Replay is what tests use, and it only produces visuals for the bundled fixture books. Use `live` for your own books.

## Start the reader

### Development server

```bash
pnpm dev
```

Open **http://127.0.0.1:7127/login** (use `127.0.0.1`, not `localhost`, because cookies differ between the two), choose **Continue with ChatGPT** and grant plan usage. Then import an EPUB, open it and press **Alt+I** to open the Illustrate pane.

To skip the login screen during development, set `ILLUS_AUTH_GATE=off`. Production builds ignore this setting.

### Production build on your laptop

```bash
pnpm --filter @flow/reader build
pnpm --filter @flow/reader exec next start -p 3000 -H 127.0.0.1
```

Set `ILLUS_PUBLIC_URL=http://127.0.0.1:3000` and open exactly that URL.

## Self-hosting with Docker

```bash
cp apps/reader/.env.local.example .env   # fill it in; set ILLUS_LLM_MODE=live
docker compose up -d --build
```

- The container listens on `127.0.0.1:3000` only.
- On first start, the entrypoint generates `ILLUS_TOKEN_ENC_KEY` and `ILLUS_SESSION_SECRET` and keeps them in the `illus-data` volume. Back up that volume and keep it private.
- On a remote URL, ChatGPT sign-in ends on a `http://127.0.0.1:7199/...` page that fails to load. That is expected: paste the full address into the reader's form within ten minutes.

For a VPS reachable only over Tailscale, reverse-proxy timeouts, backups and upgrades, see [`docs/deploy.md`](docs/deploy.md).

## Configuration

These are the main variables. The full reference is in [`docs/setup-chatgpt-signin.md`](docs/setup-chatgpt-signin.md#configuration-reference).

| Variable               | Purpose                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `ILLUS_LLM_MODE`       | `replay` (default, no model calls), `live`, or `record` (live calls that are also saved as fixtures) |
| `ILLUS_PUBLIC_URL`     | The URL you open the reader at. Dev uses `http://127.0.0.1:7127`                                     |
| `ILLUS_TOKEN_ENC_KEY`  | 32-byte key that encrypts stored ChatGPT tokens. Keep it across upgrades                             |
| `ILLUS_SESSION_SECRET` | At least 32 characters; signs session cookies                                                        |
| `ILLUS_DATA_DIR`       | Private directory for `reader.db` and secrets                                                        |
| `ILLUS_ACCESS`         | `open` (any ChatGPT account, the default) or `owner` (single owner)                                  |
| `ILLUS_ALLOWED_EMAILS` | Optional allowlist, e.g. `you@example.com,@example.org`                                              |
| `ILLUS_LOGIN_PASSWORD` | Optional owner password login, at least 16 characters                                                |
| `ILLUS_MODELS_JSON`    | Optional model and reasoning-effort overrides per role                                               |

## Development

```bash
pnpm dev                              # run the reader at http://127.0.0.1:7127
pnpm turbo run lint typecheck test    # the merge gate
pnpm e2e                              # Playwright end-to-end tests, replay mode
pnpm fixtures:epub                    # rebuild the synthetic fixture books
pnpm eval                             # live model evals (makes real calls; run manually)
```

Contributor rules, the ownership map and commit conventions are in [`AGENTS.md`](AGENTS.md). Design decisions are recorded as ADRs in [`docs/adr/`](docs/adr/). When code and spec disagree, add an ADR rather than diverging silently.

## Repository layout

```
apps/reader/                  Flow's Next.js app, plus the Illustrate pane (src/illustrate)
packages/
  illus-core/                 Zod schemas, IR, compilers, validators, flags (DOM-free)
  illus-book-index/           EPUB section tree, blocks, cross-references, CFI mapping
  illus-concepts/             Concept indexer, glossary, growing concept models
  illus-context/              Token-budgeted context packer
  illus-llm/                  LLM client, prompt registry, model config, record/replay
  illus-pipeline/             Per-section orchestrator, queues, whole-book runs
  illus-render/               ELK, Mermaid, Vega-Lite, KaTeX renderers and templates
  illus-anim/                 Step-animation player
  illus-tracer/               Pyodide trace worker and trace view
  illus-reader-bridge/        epub.js location, quote → CFI, highlights, selection
  illus-store/                IndexedDB (Dexie) repositories, cache export/import
docs/                         Spec, deploy guide, sign-in guide, ADRs, prompts
evals/                        Eval harness
fixtures/                     Synthetic books and recorded LLM responses
```

## Further documentation

| Document                                                       | What it covers                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`docs/spec.md`](docs/spec.md)                                 | The v1 spec: goals, architecture, IR, pipeline, renderers            |
| [`docs/deploy.md`](docs/deploy.md)                             | Docker, VPS over Tailscale, reverse proxies, backups, upgrades       |
| [`docs/setup-chatgpt-signin.md`](docs/setup-chatgpt-signin.md) | Sign in with ChatGPT, access control, configuration, troubleshooting |
| [`docs/flow-audit.md`](docs/flow-audit.md)                     | How Flow's internals work, for anyone changing `apps/reader`         |
| [`docs/contracts.md`](docs/contracts.md)                       | Shared contracts between packages                                    |
| [`docs/dependencies.md`](docs/dependencies.md)                 | Pinned dependencies and why each is there                            |
| [`docs/prompts/`](docs/prompts/)                               | The prompt for each model role                                       |
| [`docs/adr/`](docs/adr/)                                       | Architecture decision records                                        |

## License and credits

Flow AI is licensed under [AGPL-3.0](LICENSE), like Flow.

- [Flow](https://github.com/pacexy/flow) by pacexy, the reader this project is built on
- [Epub.js](https://github.com/futurepress/epub.js/), [React](https://github.com/facebook/react), [Next.js](https://nextjs.org/), [TypeScript](https://www.typescriptlang.org), [Turborepo](https://turbo.build/repo)
- [ELK](https://github.com/kieler/elkjs), [Mermaid](https://mermaid.js.org), [Vega-Lite](https://vega.github.io/vega-lite/), [KaTeX](https://katex.org), [Pyodide](https://pyodide.org), [Zod](https://zod.dev), [Dexie](https://dexie.org)
