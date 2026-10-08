# Multi-agent build kit — setup

This kit turns the "AI Illustrated Reader — v1 Spec" into a Claude Code build run by an orchestrator and 12 workstream subagents (spec §20–21).

## What's inside

| Path | What it is |
| --- | --- |
| `CLAUDE.md` | Project rules every session and agent follows: ownership map, golden rules, commands, commit style |
| `.claude/commands/build-reader.md` | The `/build-reader` orchestrator: waves, merging, gates, checkpoints |
| `.claude/agents/w0-foundation.md` … `w11-deploy-security.md` | One subagent per workstream, each with spec sections, owned paths, deliverables, "done when" and a fixed report format |
| `docs/build-log.md` | Progress log the orchestrator appends to (lets you resume) |
| `docs/adr/0000-template.md` | Template for architecture decision records |

## One-time setup

1. Fork `pacexy/flow` on GitHub and clone your fork.
2. Copy everything in this folder into the repo root, keeping paths (`CLAUDE.md`, `.claude/`, `docs/`). Flow's existing `AGENTS.md` can stay.
3. Export the spec: open the spec doc → export as **Markdown** → save it as `docs/spec.md`. The two diagrams become placeholders in Markdown; everything agents need is in the text and tables.
4. Commit on `main`: `git add -A && git commit -m "Add spec and multi-agent build kit"`.
5. Optional, to avoid approving every shell command: add to `.claude/settings.json`
   ```json
   { "permissions": { "allow": ["Bash(pnpm:*)", "Bash(git:*)", "Bash(npx:*)", "Bash(node:*)"] } }
   ```

## Run it

1. Start Claude Code in the repo root. Use your strongest model for this main session, because it plans and merges; subagents inherit it (`model: inherit`), and you can change any agent's `model` field.
2. Run `/build-reader`.
3. Wave 0 runs alone and stops for your review of `docs/flow-audit.md`, `docs/contracts.md` and `docs/dependencies.md`. Approve or ask for changes.
4. Waves 1–4 run in parallel within each wave, each agent in its own git worktree. The orchestrator merges, runs `pnpm turbo run lint typecheck test` (plus `pnpm e2e` from wave 3), and logs every wave in `docs/build-log.md`.

| Wave | Agents |
| --- | --- |
| 0 | W0 foundation |
| 1 | W1 book index · W2 LLM + store · W4 renderers · W10 quality (phase A) |
| 2 | W3 pipeline · W5 templates · W11 deploy + security |
| 3 | W6 animation · W7 tracer · W9 reader UI |
| 4 | W8 concept models · W10 quality (phase B) |

## Resuming and targeting

- `/build-reader from wave 2` — resume after a stop (it checks the build log first).
- `/build-reader only W7` — re-run one workstream.
- `/build-reader no-pause` — skip the wave 0 checkpoint (not recommended the first time).

A full run is long and uses a lot of model usage. It's fine to stop between waves and resume in a fresh session; the build log carries the state.

## Things only you can do

The orchestrator lists these in a final "Hand-off" entry:

1. Register the Sign in with ChatGPT client and fill `.env.local` — follow `docs/setup-chatgpt-signin.md` (written by W2).
2. Record live LLM fixtures with `ILLUS_LLM_MODE=record`, replacing hand-written ones.
3. Run `pnpm eval --live` and the effort sweep; adjust `ILLUS_MODELS_JSON` from the results.
4. Deploy with `docs/deploy.md` (written by W11).

## If something goes wrong

- An agent reports `blocked` → the orchestrator retries once, then asks you.
- A contract needs changing → agents file a request; the orchestrator shows it to you, then re-runs W0 to amend contracts.
- Leftover worktrees → `git worktree list` and `git worktree prune`.
