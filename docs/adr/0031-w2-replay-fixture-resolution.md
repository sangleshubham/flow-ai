# 0031 — Resolve reader replay fixtures from its workspace

- Status: accepted
- Date: 2026-10-09
- Workstream: W2
- Spec sections: §4, §9, §18

## Context

`createIllusServer` defaults to `<cwd>/fixtures/llm`. The reader's dev/start commands run with `apps/reader` as their current directory, causing replay to load an absent app-local directory and return fixture misses despite populated repository fixtures. Packages must not import app code or depend on the reader's repository layout.

## Decision

Resolve the reader's default disk fixture directory in `apps/reader/src/server/llm`, by walking from the launch directory to the nearest ancestor containing `pnpm-workspace.yaml`. Use that workspace's `fixtures/llm` directory in replay and record mode. Preserve `ILLUS_FIXTURES_DIR` as the first choice, including its existing relative-path behavior. Live mode and injected fixture stores bypass discovery. Leave the reusable `@illus/llm/server` default unchanged.

If no workspace can be found, require an explicit directory and report `ILLUS_FIXTURES_DIR` in the initialization error. Keep strict loading of all fixture envelopes and normal server-side output schema validation.

## Consequences

Root launches, reader launches, and isolated worktrees select the correct fixtures. App tests exercise the complete on-disk fixture set through `fileFixtures` and the route's server factory, with fake Responses API record/replay coverage. No dependency or shared contract changes are needed.

Standalone Docker images currently omit the workspace manifest and fixture tree. Replay/record in those deployments needs a mounted directory and `ILLUS_FIXTURES_DIR`; live operation does not. Container packaging remains W11's responsibility.
