# Tasks: richer, animated, context-aware visuals + no stuck sections

Source plan for the `fix-*` agents in `.claude/agents/`. Each agent works only on its own `## Tn` section and the files listed there. Shubham's decisions:

- The AI may read the open section's own subsections (same chapter, never later chapters), still with verbatim evidence.
- Keep model efforts; fix the hangs instead.

## Why (live-mode complaints → verified causes)

| Complaint                                                                                                 | Cause                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visual is basic, no animation                                                                             | All flags default `false` (`packages/illus-core/src/flags/index.ts`), so `template:comparison` and every animation are dropped. The planner isn't told which kinds are on, so it plans templates that `pipeline.ts` then filters out. The animator never gets `<targets>`/`<supported_actions>`, which `docs/prompts/animator.md` expects, so it guesses ids, fails validation and is dropped. |
| "Only reads the section, not the whole context" (Replication → single-leader / multi-leader / leaderless) | `packContext` never includes the open section's subsections. The prompts forbid inference and later concepts (`planner.md` rules 2, 6). No "kinds of X → comparison" guidance. The book summary and glossary arrive late (`SUMMARY_AT=0.3`, `GLOSSARY_EVERY=50`).                                                                                                                              |
| Planner text is very small                                                                                | The pane shows only `intent` (≤25 words) and a one-line `reason`.                                                                                                                                                                                                                                                                                                                              |
| Sections get stuck, slow                                                                                  | Extractor, animator and repair calls get no abort signal, and retries ignore `job.cancelled`, so old jobs hold the 2 section slots. The stream body has no timeout (the SDK timer stops at headers). The UI ignores `item-progress` stages.                                                                                                                                                    |

## Rules for every task

- Read `CLAUDE.md` first. Edit only the files your task owns. Need something else? Say so in your final report and don't edit it.
- Pure logic is written test-first. `ILLUS_LLM_MODE=replay`: no live model calls, ever.
- Never spawn agents.
- Before your final report, run `pnpm --filter <your package> lint typecheck test` for every package you touched.
- Commit in your worktree with the given prefix, one logical change per commit with its tests, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If git fails in the worktree, leave the changes uncommitted and say so.
- Final report (≤ 200 words):
  - files changed
  - commits
  - test results
  - anything blocked or left for another task

## Waves

The orchestrator sets Status to `done` once a task is merged into `main` and gated.

| Wave | Tasks              | Runs                                                                                       |
| ---- | ------------------ | ------------------------------------------------------------------------------------------ |
| 1    | T1, T2, T3, T4, T5 | parallel, own worktrees; orchestrator merges into `main` + `pnpm turbo run typecheck test` |
| 2    | T6, T7             | parallel on merged main; merge + gate                                                      |
| 3    | T8                 | alone; then the final gate `pnpm turbo run lint typecheck test` + `pnpm e2e`               |

| ID  | Agent               | Owner prefix | Model / effort  | Depends    | Status |
| --- | ------------------- | ------------ | --------------- | ---------- | ------ |
| T1  | `fix-llm-stream`    | W2           | sonnet / medium | —          | done   |
| T2  | `fix-contracts`     | W0           | sonnet / medium | —          | done   |
| T3  | `fix-anim-targets`  | W6           | sonnet / low    | —          | done   |
| T4  | `fix-context-pack`  | W3           | opus / high     | —          | done   |
| T5  | `fix-prompts`       | W3           | opus / high     | —          | todo   |
| T6  | `fix-pipeline`      | W3           | opus / high     | T2, T3, T4 | todo   |
| T7  | `fix-pane-ui`       | W9           | sonnet / medium | T2         | done   |
| T8  | `fix-fixtures-gate` | W3/W0        | sonnet / high   | all        | todo   |

---

## T1: Stream idle timeout (W2)

**Files:** `packages/illus-llm/src/server/openai-provider.ts`, `packages/illus-llm/test/openai-provider.test.ts` (plus `test/helpers.ts` if you need a stalling SSE helper).

The openai SDK's `timeout` (180 s) only covers the time until response headers arrive. The `for await (const event of stream)` loop can then hang forever on a stalled stream.

- Export `STREAM_IDLE_MS = 180_000` (reasoning is silent, so not tighter than the per-attempt timeout), and add an optional `idleTimeoutMs` to `OpenAiProviderOptions`.
- Create a local `AbortController`, and pass `AbortSignal.any([req.signal, idle.signal].filter(Boolean))` to `client.responses.create`.
- Start a timer before the request and reset it on every stream event. On expiry, abort and throw `ProviderError('timeout', 'no stream event for Ns')`. Check that `'timeout'` is a valid kind in `ProviderError` and that the gateway retries it.
- Clear the timer in `finally`.
- Keep the `output_item.done` fallback that is already there.
- Do not change the gateway's retry policy.

**Done when:**

- A test with a fake SSE response that sends one event and then never ends rejects with a timeout `ProviderError` within the configured `idleTimeoutMs` (e.g. 50 ms).
- A caller abort still aborts.
- All existing tests pass.

**Commit:** `W2: abort stalled Responses streams after an idle timeout`

---

## T2: Contracts — plan text, plan key, default flags (W0)

**Files:** `packages/illus-core/src/{schemas,cache-keys,flags,testing}` and their tests, plus `docs/contracts.md`.

1. **`schemas/plan.ts`**
   - Add `VisualPlan.overview: maxWords(120).optional()`. Docstring: 2–4 plain sentences giving the big idea of the section for a reader who has not read it, only from facts in the provided text.
   - Add `PlanItem.caption: maxWords(60).optional()`. Docstring: what this visual shows and how to read it.
   - Both are optional so old cached plans still parse.
   - Check that `packages/illus-llm/src/json-schema.ts` handles the new optional strings without changes (it turns optional into required-and-nullable). Don't edit it; report if it breaks.
2. **`cache-keys`**
   - Add an optional `kinds?: string` to the `planKey` input: a sorted, comma-joined list of enabled flag-gated kinds.
   - When it is absent, the key must equal today's key exactly (test this).
   - When it is present, it is part of the hash.
3. **`flags/index.ts`**
   - Set `DEFAULT_FLAGS.templates = true` and `animations = true`; the others stay false.
   - Update the file comment and the flag tests.
4. **`testing` `make` helpers**
   - `make.visualPlan()` and `make.planItem()` may include `overview`/`caption` only as optional overrides.
   - Don't add them by default: replay fixtures hash plan JSON.
5. **`docs/contracts.md`**
   - Note the two new fields, `planKey.kinds` and the new flag defaults.

**Done when:** `pnpm --filter @illus/core lint typecheck test` is green, and the key-stability test passes.

**Commits:**

- `W0: add plan overview and item caption`
- `W0: plan key can include enabled kinds`
- `W0: templates and animations on by default`

---

## T3: Export animation targets (W6)

**Files:** `packages/illus-core/src/anim/*` and its tests.

`buildFrames` computes the valid targets (template `targets(props)` or `specTargets(ir)`) and the supported actions (template `supportedActions`, or `BASE` plus `token` for graph/state) inline.

- Extract that into an exported function: `animationTargets(ir: IR, options: AnimationOptions = {}): { targets: string[]; supportedActions: string[] }`. `targets` comes out sorted and deduplicated.
- `buildFrames` must use it, with the same behaviour.
- Export it wherever `buildFrames` is exported from the package's public API (`src/index.ts` / the `@illus/core/anim` subpath).

**Done when:**

- Tests cover a graph IR, a sequence IR and a template IR via a stub registry.
- All existing anim tests are unchanged and green.

**Commit:** `W6: export animationTargets for the animator prompt`

---

## T4: Subsections slot + earlier book context (W3)

**Files:**

- `packages/illus-context/src/*` and its tests
- `packages/illus-concepts/src/pass.ts`
- the tests asserting its constants

1. **`pack.ts`: new slot `subsections`**, inserted right after `current` in `SLOT_NAMES`, `SLOT_CAPS` and the fill order.
   - Collect the descendants of the current section (walk `parentId` over `allSections`), in ordinal order. Never include siblings, ancestors or anything outside the subtree.
   - Skip the slot for `input.synthetic`.
   - Render the slot as `<subsections>`. Inside it, one `<subsection title="…" depth="n">` per descendant holds that section's first blocks via `renderBlock`.
   - Clip each descendant with `clipTokens` to `SUBSECTION_TOKENS = 600`. `SLOT_CAPS.subsections = 4000`.
   - Each item's `blockIds` are the rendered block ids, so they join `usedBlockIds` (the grounding whitelist).
   - Since a capped slot stops at the first item that doesn't fit, emit a titles-only outline item first, then the per-child text items.
   - Bump `CONTEXT_VERSION` to 2.
2. **`pass.ts`:** set `SUMMARY_AT = 0.1` and `GLOSSARY_EVERY = 15`, and update any test that pins the old values.

**Done when:**

- Unit tests show that a parent section packs its children's text and block ids.
- A sibling, a later chapter and ancestors are never packed.
- A synthetic section has no subsections slot.
- The cap drops the text items before the outline.
- `pnpm --filter @illus/context --filter @illus/concepts lint typecheck test` is green.
- Fixture-key fallout in other packages is T8's job; just list it in your report.

**Commits:**

- `W3: pack the open section's subsections`
- `W3: earlier book summary and glossary merges`

---

## T5: Planner and extractor prompts + ADR (W3)

**Files:**

- `docs/prompts/planner.md`
- `docs/prompts/extractor.*.md`
- `fixtures/llm/planner/`, `fixtures/llm/extractor.*/`, only for hand-written examples if the prompt files embed them
- a new `docs/adr/0045-wider-context-plan-text-defaults.md` (copy `docs/adr/0000-template.md`)

Inputs the pipeline will send after T4 and T6:

- `<subsections>` (descendant sections of the open one, with `<block id>`s that are quotable evidence)
- `<available_kinds>kind, kind, template:…</available_kinds>` (only these may be planned)

Plan output gains `overview` and per-item `caption` (T2).

**planner.md** (bump `version` to 1.1.0 and add a changelog line):

- Rule 1: add `<subsections>` and `<available_kinds>` to the data tags.
- Rule 6 becomes: "Never describe concepts from later chapters. Blocks inside `<subsections>` belong to this section's own subsections: use and quote them to show the whole topic."
- New rule: "Plan only kinds listed in `<available_kinds>`; if it is absent, use the table below."
- New guidance:
  - "Aim for the big picture: the visual must make sense to a reader who has not read the text yet."
  - "When the section or its subsections present several approaches, variants or types of one idea (e.g. kinds of replication), plan a comparison: `template` `comparison` when available, otherwise a `graph` TB taxonomy with one node per variant and its defining trait."
- Add that kind-table row.
- Document the `overview` and `caption` output fields. Both must be plain, concrete and backed by the provided text.
- `animate`: keep "process only", and add examples like "a write flowing from leader to followers" and "a request retried after a failure".
- Add one worked example:
  - a "Replication" intro with three `<subsection>`s
  - output: an overview, a comparison item with a caption, and an animated graph of leader → follower propagation

**extractor.\*.md** (bump the minor version of each): apply the same rule-6 wording, so evidence from `<subsections>` blocks is allowed. Add `<subsections>` to rule 1's data tags.

**ADR 0045:** covers

- the spec §7/§8 change (same-chapter descendants as context and evidence; later chapters still excluded)
- the `subsections` slot
- `overview`/`caption`
- the `templates`/`animations` defaults on
- the 180 s stream idle timeout
- earlier summary/glossary thresholds

Status: accepted (decided by Shubham, 2026-10-10).

**Done when:**

- The prompts parse: run the prompt-loader tests, e.g. `pnpm --filter @illus/llm test` and `apps/reader` `server-config`/prompt-file tests if they read `docs/prompts`.
- Front matter is valid.
- The ADR exists.

**Commits:**

- `W3: planner prompt for whole-topic comparisons, overview and captions`
- `W3: extractors may quote subsections`
- `W3: ADR 0045`

---

## T6: Pipeline wiring (W3), after T2, T3, T4 are merged

**Files:** `packages/illus-pipeline/src/*` and `packages/illus-pipeline/test/*`. Leave fixture JSON regeneration to T8.

1. **Cancellation:**
   - Add `signal` to `callOpts`, so every extractor, animator, repair and review call gets the job's abort signal.
   - Return or throw a cancel before each retry, escalate, animate and repair step when `job.cancelled`.
   - A cancelled job must still emit `done`.
2. **Empty-plan guard:** `needsVisual` with zero runnable items after the flag filter and the `planItemId` filter must emit `no-visual` (the flag-specific message already exists; add a generic one).
3. **Available kinds:**
   - Build `availableKinds` from all `VisualKind`s through `kindEnabled`. Templates are listed as `template:<id>` for the registered template ids when `deps.templates` is present, otherwise as `template`.
   - Append `<available_kinds>…</available_kinds>` to the planner body.
   - Pass the flag-gated part as `planKey({ …, kinds })` (T2), so toggling a flag re-plans.
4. **Animator inputs:** append `<targets>…</targets><supported_actions>…</supported_actions>` from `animationTargets(ir, { templates })` (T3) to the animator body, in the exact tag format of `docs/prompts/animator.md`.
5. **Plan text:** make sure `overview` and `caption` survive into the stored plan record and the emitted plan event (they are part of `res.data`).

**Done when:** new tests show that

- a job cancelled during extraction makes no further LLM calls and emits `done`
- the planner body contains `<available_kinds>` and it changes with flags
- the plan key changes with flags
- the animator body contains `<targets>` and `<supported_actions>`
- an empty plan gives `no-visual`

Replay-fixture misses caused by changed bodies are expected: list them for T8 rather than hand-editing fixture keys.

**Commits:**

- `W3: pass the job signal to every call and stop on cancel`
- `W3: tell the planner which kinds are available`
- `W3: give the animator its targets and actions`

---

## T7: Pane UI — stages, overview, captions (W9), after T2

**Files:** `apps/reader/src/illustrate/state.ts`, `apps/reader/src/illustrate/PaneContent.tsx`, their tests, and the illustrate CSS if a class is needed.

1. **`state.ts`:**
   - On `item-progress`, store the latest stage per item. The existing catch-up handling must keep working.
   - Expose a human label: `planning` → "Planning the visual…", `extracting` → "Drawing the diagram…", `retrying` → "Fixing the diagram…", `escalating` → "Trying a stronger model…", `animating` → "Adding animation…", `critic` → "Checking the result…", `cached` → none.
   - Before the plan arrives, show "Planning the visual…" instead of "Reading this section…".
2. **`PaneContent.tsx`:**
   - Render the stage label under each skeleton in an `aria-live="polite"` element.
   - Render `plan.overview` (when present) as a normal-size paragraph above the item tabs.
   - Render the active item's `caption` above its visual.
   - Keep the existing accessibility (tabs, labels).

**Done when:**

- Component or state tests show the stage text changes with `item-progress`, and that `overview` and `caption` render when present and are absent otherwise.
- `pnpm --filter <reader package> lint typecheck test` is green.

**Commits:**

- `W9: show generation stages in the pane`
- `W9: show plan overview and visual captions`

---

## T8: Fixtures and final gate (W3/W0), after all merges

**Files:**

- `fixtures/llm/**`
- `packages/*/test/**/fixtures*`
- the test files that need key updates
- hand-written fixtures (`"source": "handwritten"`)

1. Run `pnpm turbo run lint typecheck test --force` and collect the failures.
2. Regenerate the replay fixtures that changed because of the new prompt versions, the packed body and the planner/animator bodies, using the existing scripts only:
   - `pnpm --filter @illus/pipeline fixtures:llm`
   - `pnpm --filter @illus/pipeline fixtures:browser`. After a key change, delete stale browser fixtures, since the script never removes them.
   - `ILLUS_WRITE_FIXTURES=1 pnpm --filter @illus/concepts test`
   - `ILLUS_WRITE_FIXTURES=1 pnpm --filter @illus/evals test quality-prompts`, if the critic or repair inputs changed
3. A fixture that a script can't produce (one that would need a live call) is written by hand, with `"source": "handwritten"` and a valid output for the new schema.
4. Fix only the test fallout. If a real bug shows up in another task's code, report it rather than fixing it.
5. Gate:
   - `pnpm turbo run lint typecheck test` ✓
   - `pnpm e2e` ✓ (replay)

**Done when:** both gates are green.

**Commit:** `W3: regenerate replay fixtures for prompt 1.1 and context v2`

---

## Manual live check (Shubham)

1. In Illustrate settings, turn on Templates and Animations. Saved preferences keep the old `false` values.
2. Open a "Replication" chapter intro (`pnpm dev`). Expect:
   - an overview paragraph
   - a comparison or taxonomy of the approaches, with clickable evidence that includes subsection quotes
   - an animated flow card
3. Navigate quickly across 5 sections. Stage text should update, and nothing should stay stuck on "Planning…".
