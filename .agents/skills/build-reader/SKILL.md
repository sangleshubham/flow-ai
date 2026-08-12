---
name: build-reader
description: Orchestrate the multi-agent build of the AI Illustrated Reader from docs/spec.md wave by wave, spawning the custom agents in .codex/agents in per-workstream git worktrees, merging and gating. Use when Shubham asks to build, continue or resume the reader build.
---

# Build the AI Illustrated Reader (orchestrator)

You are the **orchestrator**. You plan, create worktrees, spawn workstream subagents, merge their branches and run gates. You do **not** write feature code yourself.

Shubham may add: `from wave N` (resume), `only W<n>` (one workstream), `no-pause` (skip the wave 0 checkpoint). Default: start at wave 0.

## Keep your context lean

- Read only spec §2, §20 and §21 from `docs/spec.md`, plus `AGENTS.md` and `docs/build-log.md`. Subagents read the rest.
- Work only from subagents' final reports; don't pull their logs into this thread.
- Never open large generated files (lockfiles, fixtures, build output).

## Preflight (stop and tell Shubham if any check fails)

1. `docs/spec.md` exists and contains "## 20. Subagent workstreams".
2. Working tree is clean and on `main`; record `git rev-parse HEAD`.
3. `node -v` (24 LTS expected) and `pnpm -v` work.
4. All 12 custom agents exist in `.codex/agents/` (`w0_foundation` … `w11_deploy_security`).
5. `.worktrees/` is in `.gitignore` (add and commit it if not: `Orchestrator: ignore worktrees`).

## Waves

| Wave | Custom agents | Notes |
| --- | --- | --- |
| 0 | `w0_foundation` | Runs alone, then the human checkpoint. |
| 1 | `w1_book_index`, `w2_llm_store`, `w4_renderers`, `w10_quality` (phase A) | |
| 2 | `w3_pipeline`, `w5_templates`, `w11_deploy_security` | |
| 3 | `w6_animation`, `w7_tracer`, `w9_reader_ui` | |
| 4 | `w8_concept_models`, `w10_quality` (phase B) | |
| Final | none | Final gate and hand-off notes. |

### Starting a wave

1. For each workstream in the wave, from the main checkout on an up-to-date `main`:
   ```
   git worktree add .worktrees/<wN> -b ws/<wN>-wave<N> main
   ```
2. Spawn **one subagent per workstream, all in parallel**, using the custom agent of that name, and wait for all of them. Each spawn prompt must contain:
   - the absolute worktree path and branch name, with "cd there first and work only there";
   - the wave number, and for `w10_quality` the phase (`A` or `B`);
   - the current `main` commit SHA;
   - "Read AGENTS.md, then your spec sections, then docs/flow-audit.md (except W0)";
   - "Finish with the report format from your instructions."

## Human checkpoint after wave 0 (unless `no-pause`)

Stop and ask Shubham to review `docs/flow-audit.md`, `docs/contracts.md` and `docs/dependencies.md`. Contracts freeze at v1.0 only after he approves. Do not start wave 1 before that.

## Merging a wave

For each report:
1. Status `done` → from the main checkout: `git merge --no-ff ws/<wN>-wave<N> -m "Merge W<n>: <one-line summary>"`.
2. Status `blocked` or `partial` → re-spawn the same custom agent once in the same worktree with the blocker. Still blocked → record it in the build log and ask Shubham.
3. `pnpm-lock.yaml` conflict → take `main`'s version, run `pnpm install`, commit `Orchestrator: regenerate lockfile`.
4. Any other conflict → abort the merge, re-spawn the owning agent (ownership map in `AGENTS.md`) in a fresh worktree from the new `main` with the conflict details.

After all branches of the wave are merged, run the gate in the main checkout:

```
pnpm install
pnpm turbo run lint typecheck test
pnpm e2e          # from wave 3 onwards, once W9 exists
```

- Failure → map the failing package path to its owner, re-spawn that agent in a fresh worktree from `main` with the failing output (max 2 attempts per agent per wave), merge, re-run the gate.
- Still failing → stop, write the state to the build log, ask Shubham.
- Green → `git worktree remove .worktrees/<wN>` for each, `git worktree prune`, delete merged `ws/*` branches, append the wave entry to `docs/build-log.md`, commit `Orchestrator: wave N complete`.

Build-log entry format:

```
## Wave N — YYYY-MM-DD
- Agents: …
- Branches merged: …
- Gate: lint ✓ typecheck ✓ test ✓ e2e ✓/n.a.
- ADRs opened: …
- Contract-change requests: …
- Open questions for Shubham: …
- Follow-ups for later waves: …
```

## Contract-change requests

Collect them, show them to Shubham at the end of the wave, and apply approved changes by spawning `w0_foundation` with an "amend contracts" task (in its own worktree) before the next wave.

## Final gate (after wave 4)

1. Run the full gate including `pnpm e2e`.
2. List which §18 acceptance criteria pass in replay mode and which need live runs.
3. Write a "Hand-off" entry in the build log with the steps only Shubham can do: register the Sign in with ChatGPT client and fill `.env.local` (`docs/setup-chatgpt-signin.md`), record live fixtures (`ILLUS_LLM_MODE=record`), run `pnpm eval --live` and the effort sweep, deploy with `docs/deploy.md`.
4. Stop.

## Rules for you

- Never edit files owned by a workstream; re-spawn the owner instead.
- Never weaken a test, lint rule or flag to make a gate pass.
- Never run the app's live model calls or touch real credentials.
- Plus plan usage is shared with your other ChatGPT apps: if you hit a usage limit, stop cleanly, write the state to the build log, and tell Shubham how to resume (`from wave N`).
- If two reports contradict each other or the spec, stop and ask Shubham.
