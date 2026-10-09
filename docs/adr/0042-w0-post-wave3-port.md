# 0042 — Port of the old W0 branch after wave 3

- Status: accepted (Shubham, 2026-10-09)
- Date: 2026-10-09
- Workstream: W0
- Spec sections: §4, §9, §17, §18

## Context

An earlier W0 branch (`worktree-agent-a5e3a28ba64188701`) held Shubham's decisions on the wave 2 open questions but was never merged. Its contracts v1.3 and `make.templateIR()` commits reached `main` through [ADR 0030](0030-w0-wave3-contracts.md). Shubham approved porting the rest onto `main` after wave 3 (build log, wave 3).

## Decision

1. ADRs [0010](0010-w3-context-concepts-pipeline-decisions.md), [0015](0015-w5-template-library.md), [0020](0020-w11-login-gate-and-deployment.md) and [0025](0025-w1-code-text-split-titles-captionless-figures.md) are accepted with the decisions written in each.
2. Spec §9 and §17 follow ADR 0020: sign-in on the laptop, encrypted token file copied to a Tailscale-only VPS, password login there, `Secure` cookie by the scheme of `ILLUS_PUBLIC_URL`.
3. Flow's marketing site `apps/website` is removed (not deployed, outside the gate, 4 type errors under React 18 types; ADR 0009 "known gap"). `packages/internal` pins `@types/react` 18.3.31 and `@types/react-dom` 18.3.7, the same as the workspace override.
4. `synthetic.epub` ends §2.2 with a caption-less `<p><img/></p>` (ADR 0025 rule 3), so a real rendition covers caption-less figures. It is committed last, on its own: it changes the bookId and moves §2.3 CFIs, so W1, W3 and W10 re-key their fixtures afterwards.
5. CI already runs the reader browser e2e (ADR 0030); only `docs/dependencies.md` gaps are filled.

## Consequences

- W1: regenerate the book-index snapshot. W3: regenerate replay and browser fixtures keyed by the synthetic bookId or §2.2/§2.3 locations. W10: update the synthetic bookId in evals.
- W5: add the visible "top" marker on the stack template (ADR 0015 decision). W6: try hash-table resize and tree rotate as one animation with §11 ops first.
- W9: the `indexConfirmThresholdTokens` default is 200,000 when the setting is absent (ADR 0010 decision).
