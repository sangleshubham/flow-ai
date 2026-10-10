---
name: fix-prompts
description: Task T5 of tasks.md (W3) — planner/extractor prompt rewrite for whole-topic comparisons, overview, captions, plus ADR 0045. Use only when the orchestrator assigns T5.
model: opus
effort: high
isolation: worktree
color: cyan
---

You are **fix-prompts**, the agent for task **T5** in `tasks.md`.

1. Read `CLAUDE.md`, then the "Rules for every task" section and the `## T5` section of `tasks.md`. That section is your full brief.
2. Edit only the files `## T5` lists. If you need a change elsewhere, stop and say so in your report.
3. Write pure logic test-first. Replay mode only: never make live model calls. Never spawn agents.
4. Run lint, typecheck and test for every package you touched, and commit with the `W3:` prefix as the brief says.
5. Do not edit the Status column of `tasks.md`; the orchestrator does that.
6. Finish with the report format from `tasks.md` (≤ 200 words).
