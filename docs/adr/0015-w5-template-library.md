# 0015 — Template library: props shapes, targets, frames and edits outside W5's path

- Status: proposed
- Date: 2026-10-09
- Workstream: W5
- Spec sections: §5, §8 stage 2, §10, §11, §16, §19

## Context

§10 lists 16 templates with key props, limits and animation verbs, but not their exact schemas, element paths or how §11's generic actions map onto each template. `TemplateSpec` (contracts v1.2) has no way for W6's reducer to know a template's valid targets or the initial contents of its containers. Props schemas are sent to OpenAI strict structured outputs through `@illus/llm`'s adapter, which cannot express records (open keys) or `$ref` recursion. W5 owns only `packages/illus-render/src/templates`.

## Decision

1. **Schemas are strict-output friendly.** No `z.record`, no recursion: trees are flat node lists with `parent` (+ `side` for binary variants), named things are lists (`pointers: [{ name, index }]`). Optional fields become nullable in strict mode (handled by `@illus/llm`). Size limits follow §10; where §10 is silent: graph-ds edges ≤ 28, hash entries ≤ 16, memory heap ≤ 12 (frames + heap ≤ 16), bits ≤ 512, comparison cells ≤ 32, set-ops ≤ 5 members per region, array pointers ≤ 6 and ranges ≤ 4, grid arrows ≤ 8.
2. **Extra template fields** beyond `RenderTemplate`: `evidencePaths` and `targetsDoc` (prompt docs), `targets(props)` (every valid §11 target), `initialFrame?(props)` (pointers and containers for frame 0) and `exampleEvidence` (the worked example's evidence, so `templateDoc` shows a full `TemplateIR`).
3. **Ids.** Every element carries `data-ir-id` = the most specific evidence path that covers it (`values` covers `values.3`) and `data-target` = its §11 target.
4. **Positions are targets; `swap` exchanges contents.** A template draws at position `t` the content of the element whose `slots` entry is `t`, unless `values[t]` overrides it. Highlights stay on positions (matches "compare a[i] and a[j]" narration and heap sift-up).
5. **Containers.** When `frame.containers[c]` exists it is the full current contents of container `c`; otherwise the props are. A repeated id keeps its last occurrence (cache: `enqueue` of an existing key moves it to the most-recent end). Container names: `stack`, `queue`, `frames` (memory), `order` (cache).
6. **Verbs from §10 with no §11 op**: linked-list *relink* = `set` on `edge:next-<id>` with a node id or `"null"`; memory *point* = `set` on `edge:<pointerId>` with a heap id; pipeline *move item* = `set` on `item:<id>` with a stage id; graph-ds *visit/relax* = `highlight` (+ `set` distance); call-tree *call/return/memo-hit* = `reveal` / `set` / `highlight` success; tree *path* = `token` or highlights; layers *encapsulate* = `set` (badge). **Not supported in v1**: hash-table *resize* and tree *rotate* — both need structural re-mapping no §11 op expresses; the animator shows them as two visuals. This is the conservative choice; it can be added with a new op later.
7. **`dropElement`** removes list elements and what depends on them (incident edges, subtrees, cells of a dropped option); grid cells and headers are blanked. Where removal would shift other elements (array values, bit fields, a tree or call-tree root, the last 2 options/sets) it throws `TemplateDropError`; `validate()` should then keep the grounding error.
8. **Other choices**: the `stack` template has no `top` prop (the last item is the top); `graph-ds` `layout(props)` returns the ELK input and the component runs ELK `stress` in the layout worker (in-thread when `Worker` is missing); trie nodes hold one short string, the root none; heap order is checked with `≤`/`≥` (duplicates allowed), BST with strict `<`.
9. **Edits outside `src/templates`** (minimal, needed to ship): `packages/illus-render/src/index.ts` gains `export * from './templates/index.ts'` (no deep imports allowed); `packages/illus-render/package.json` gains `d3-hierarchy` 3.1.2 (in §19 and `docs/dependencies.md`) and `zod` 4.6.5 (workspace version, already used by `@illus/core`); `pnpm-lock.yaml` accordingly. d3-hierarchy has no bundled types, so a minimal local declaration lives in `src/templates/d3-hierarchy.d.ts`.

## Consequences

Contract-change requests:

- **W0 / contracts**: add `targets?(props): string[]` and `initialFrame?(props): { pointers?, containers? }` to `TemplateSpec` (W6's reducer needs both to reject unknown targets and seed containers). W5 already implements them.
- **W0**: `make.templateIR()` in `@illus/core/testing` uses `pointers: { majority: 1 }` and evidence path `pointers.majority`, which the `array` schema rejects. Proposed: `props: { values: [1, 3, 3], pointers: [{ name: 'majority', index: 1 }] }`, evidence paths `values` and `pointers.0`.
- **W10**: `evals/replay/mini-stack.json` and `mini-bst.json` use props shapes that do not match (`items: [1, 2]`; tree nodes with `key/left/right`). Update to `items: [{ id, value }]` and `nodes: [{ id, keys: [k], parent, side }]` with `variant: 'bst'`. `validate()` should catch `TemplateDropError` from `dropElement`.
- **W4**: wire the template visual suite into `pnpm e2e` (`playwright test && playwright test -c src/templates/e2e`) and link `src/templates/README.md` from the package README.
- **W6**: follow decisions 4–6 in the reducer (swap moves `values` entries with the contents; containers seeded from `initialFrame`).
- **W3**: build the `extractor.template` prompt section with `templateDoc(id)`.
- **CI**: template baselines exist for darwin only (same as W4's, ADR 0006).
