# @illus/render — template library

The 16 data-structure and concept templates of spec §10, with Zod props schemas, deterministic layouts, semantic invariants, extractor docs and React components. Owner: W5. Decisions: [ADR 0015](../../../../docs/adr/0015-w5-template-library.md).

Ships behind the `templates` flag: the app passes `templateRegistry` to `<VisualView templates>`, to `validate()` (`ctx.templates`) and to `createIllusServer(env, { templates })` only while the flag is on.

## Public API (re-exported from `@illus/render`)

| Export | What it does |
| --- | --- |
| `templateRegistry`, `getTemplate(id)`, `listTemplates()` | The `TemplateRegistry` of all 16 templates, in §10 table order. |
| `templateDoc(id)` | The block the `extractor.template` prompt shows: description, when to use, evidence paths, animation targets and actions, props JSON Schema, worked example as a `TemplateIR`. |
| `templateJsonSchema(t)`, `exampleIR(t)` | The props schema as JSON Schema (strict-structured-output friendly: no records, no `$ref`), and the worked example as a `TemplateIR`. |
| `W5Template`, `AnyTemplate`, `InitialFrame`, `ContainerItem` | Types. `W5Template` is `RenderTemplate` plus `evidencePaths`, `targetsDoc`, `targets(props)`, `initialFrame?(props)` and `exampleEvidence`. |
| `TemplateDropError` | Thrown by `dropElement(props, path)` when removing that element would shift other elements (array values, bit fields, a tree root). |

Each template: `{ id, description, whenToUse, propsSchema, example, exampleEvidence, layout(props), Component, supportedActions, checkInvariants, dropElement, targets, initialFrame? }`.

| Template | Props (limits) | Layout | Invariants |
| --- | --- | --- | --- |
| `array` | `values` ≤ 16, `pointers` ≤ 6, `ranges` ≤ 4, `variant` | linear cells or bars | pointers in −1..n, ranges ordered and in range, bars numeric |
| `linked-list` | `nodes` ≤ 10, `doubly`, `head`, `tail`, `cycleTo`, `pointers` ≤ 4 | linear, back-links arc below | head first, tail last, targets exist |
| `stack` | `items` ≤ 10 (bottom first), `capacity` | vertical | capacity |
| `queue` | `items` ≤ 12, `variant` linear/deque/ring, `capacity`, `front`, `rear` | linear or circular | capacity, ring front/rear consistent |
| `hash-table` | `buckets` ≤ 12, `entries` ≤ 16, `strategy`, `hashOf`, `probe` | bucket column, chains to the right | hash in range, one entry per slot, linear-probe reachability |
| `tree` | `variant` binary/bst/heap-min/heap-max/nary/trie/btree, `nodes` ≤ 31, `showArray` | d3-hierarchy `tree()` | one root, no cycles, BST order, heap order and shape, B-tree order/arity/depth, trie |
| `graph-ds` | `nodes` ≤ 14, `edges` ≤ 28, `directed`, `weighted` | ELK `stress` (seeded), in the layout worker | endpoints exist, weights iff weighted, no self-loops or duplicates |
| `grid` | `rows`, `cols` ≤ 12, `cells`, headers, `arrows` ≤ 8 | grid | shape matches, arrows in range |
| `memory` | `frames` ≤ 6, `heap` ≤ 12, total ≤ 16, `pointers` ≤ 12 | two columns, curved pointers | sources resolve, targets are heap objects |
| `bits` | `wordSize` 8/16/32/64, `fields` ≤ 16, ≤ 512 bits | rows of `wordSize` bits | values fit their width |
| `call-tree` | `calls` ≤ 31 | d3-hierarchy | one root, memo hits are leaves |
| `pipeline` | `stages` ≤ 7, `items` ≤ 12 | left to right | items in existing stages |
| `layers` | `layers` ≤ 8, `crossings` ≤ 8 | vertical bands | crossings between existing, distinct layers |
| `cache` | `policy`, `capacity` ≤ 8, `entries` | map above eviction list | capacity, unique keys, LFU counts ordered |
| `comparison` | `options` ≤ 4, `criteria` ≤ 8, `cells` ≤ 32 | table | cells reference existing rows/columns, no duplicates |
| `set-ops` | `sets` ≤ 3, `members` ≤ 16 | fixed circles | sets exist, ≤ 5 members per region |

### Ids, targets and frames

- `data-ir-id` is the most specific evidence path covering the element (`values` covers `values.3`), so evidence hover works for coarse and fine evidence alike.
- `data-target` is the §11 target. Positions are targets: `swap` exchanges the contents of two positions. Each template's `targetsDoc` lists its scheme; `targets(props)` lists every valid target.
- Templates draw the whole `FrameState` themselves (root `data-illus-frame="self"`): highlight/hidden/removed classes, `set` values, pointers, annotations, tokens, `add`ed elements and containers. `initialFrame(props)` gives the pointers and containers a reducer should seed frame 0 with.

## Example

```tsx
import { templateDoc, templateRegistry, VisualView } from '@illus/render'

// extractor.template prompt section for the chosen template
const doc = templateDoc('tree')

// rendering (flag on)
<VisualView spec={{ ir }} theme={theme} templates={flags.templates ? templateRegistry : undefined} frame={frame} />
```

## Tests

- `pnpm test` (Vitest): `src/templates/test/` — every example renders through `VisualView` in jsdom and honours frames; registry docs, JSON round trips and strict JSON Schema; accepted and rejected invariants; `dropElement`; `validate()` with the registry.
- Visual regression (Playwright, light and dark, plus frame fixtures): `pnpm exec playwright test -c src/templates/e2e` from `packages/illus-render`. Baselines in `src/templates/e2e/__screenshots__` (darwin). Update with `--update-snapshots=all`.
