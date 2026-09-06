// Patch application (§13): a concept model's state at a section is every patch up to it, applied in
// order. Pure and immutable; an op that cannot apply is skipped and reported, never thrown.
import type {
  ConceptModel,
  ConceptModelKind,
  GraphEdge,
  GraphGroup,
  GraphIR,
  GraphNode,
  PatchOp,
  SequenceIR,
  SequenceMessage,
  SequenceParticipant,
  StateIR,
  StateNode,
  StateTransition,
} from '@illus/core'

interface ItemOf {
  node: GraphNode
  edge: GraphEdge
  group: GraphGroup
  participant: SequenceParticipant
  message: SequenceMessage
  state: StateNode
  transition: StateTransition
}
export type ElementType = keyof ItemOf
export type ModelElement = { [T in ElementType]: { type: T; item: ItemOf[T] } }[ElementType]

export interface ModelState {
  kind: ConceptModelKind
  /** Elements in creation order. */
  elements: ModelElement[]
  /** Current annotation per element, oldest first (slot 7 drops the oldest first, §7). */
  annotations: { id: string; text: string }[]
}

export interface PatchChanges {
  added: string[]
  updated: string[]
  /** Removed by an op, plus edges/messages/transitions that lost an endpoint. */
  removed: string[]
  annotated: string[]
}

export type OpIssueCode = 'wrong-kind' | 'duplicate-id' | 'unresolved-ref' | 'unknown-id' | 'invalid-update'
export interface OpIssue {
  index: number
  op: PatchOp['op']
  id: string
  code: OpIssueCode
  message: string
}

export interface AppliedPatch extends PatchChanges {
  patchId: string
  sectionId: string
  sectionOrdinal: number
  issues: OpIssue[]
}

type AddOp = Extract<PatchOp, { op: `add${string}` }>
const ADD: Record<AddOp['op'], { type: ElementType; kind: ConceptModelKind }> = {
  addNode: { type: 'node', kind: 'graph' },
  addEdge: { type: 'edge', kind: 'graph' },
  addGroup: { type: 'group', kind: 'graph' },
  addParticipant: { type: 'participant', kind: 'sequence' },
  addMessage: { type: 'message', kind: 'sequence' },
  addState: { type: 'state', kind: 'state' },
  addTransition: { type: 'transition', kind: 'state' },
}

export function isAddOp(op: PatchOp): op is AddOp {
  return op.op in ADD
}

/** The element an add op creates. */
export function addedElement(op: AddOp): ModelElement {
  const type = ADD[op.op].type
  const item = op.op === 'addNode' ? op.node : op.op === 'addEdge' ? op.edge : op.op === 'addGroup' ? op.group : op.item
  return { type, item } as ModelElement
}

/** Id an op is about. */
export function opId(op: PatchOp): string {
  return isAddOp(op) ? addedElement(op).item.id : op.id
}

/** Evidence an op carries (every op has one, §13). */
export function opEvidence(op: PatchOp) {
  return isAddOp(op) ? addedElement(op).item.evidence : op.evidence
}

/** Ids an element points at, with the type each must have. */
function refsOf(el: ModelElement): [string, ElementType][] {
  switch (el.type) {
    case 'node':
      return el.item.group ? [[el.item.group, 'group']] : []
    case 'group':
      return el.item.parent ? [[el.item.parent, 'group']] : []
    case 'edge':
      return [[el.item.from, 'node'], [el.item.to, 'node']]
    case 'message':
      return [[el.item.from, 'participant'], [el.item.to, 'participant']]
    case 'transition':
      return [[el.item.from, 'state'], [el.item.to, 'state']]
    default:
      return []
  }
}

export function emptyState(kind: ConceptModelKind): ModelState {
  return { kind, elements: [], annotations: [] }
}

export function findElement(state: ModelState, id: string): ModelElement | undefined {
  return state.elements.find((e) => e.item.id === id)
}

/** Applies ops in order. Ops that cannot apply are skipped and reported. */
export function applyOps(state: ModelState, ops: readonly PatchOp[]): { state: ModelState; changes: PatchChanges; issues: OpIssue[] } {
  let s = state
  const changes: PatchChanges = { added: [], updated: [], removed: [], annotated: [] }
  const issues: OpIssue[] = []
  const mark = (list: keyof PatchChanges, id: string) => {
    if (!changes[list].includes(id)) changes[list].push(id)
  }
  ops.forEach((op, index) => {
    const id = opId(op)
    const fail = (code: OpIssueCode, message: string) => issues.push({ index, op: op.op, id, code, message })
    const has = (ref: string, type: ElementType) => findElement(s, ref)?.type === type

    if (isAddOp(op)) {
      const el = addedElement(op)
      if (ADD[op.op].kind !== s.kind) return fail('wrong-kind', `${op.op} does not apply to a ${s.kind} model`)
      if (findElement(s, id)) return fail('duplicate-id', `id ${id} already exists`)
      const missing = refsOf(el).find(([ref, type]) => !has(ref, type))
      if (missing) return fail('unresolved-ref', `${id} refers to unknown ${missing[1]} ${missing[0]}`)
      s = { ...s, elements: [...s.elements, el] }
      mark('added', id)
      return
    }
    const cur = findElement(s, id)
    if (!cur) return fail('unknown-id', `no element ${id}`)

    if (op.op === 'update') {
      if ((op.sublabel !== undefined || op.group !== undefined) && cur.type !== 'node')
        return fail('invalid-update', `only graph nodes have a sublabel or group, ${id} is a ${cur.type}`)
      if (op.group !== undefined && !has(op.group, 'group')) return fail('unresolved-ref', `${id} refers to unknown group ${op.group}`)
      const item: Record<string, unknown> = { ...cur.item, evidence: op.evidence }
      if (op.label !== undefined) item[cur.type === 'transition' ? 'event' : 'label'] = op.label
      if (op.sublabel !== undefined) item.sublabel = op.sublabel
      if (op.group !== undefined) item.group = op.group
      s = { ...s, elements: s.elements.map((e) => (e === cur ? ({ type: cur.type, item } as ModelElement) : e)) }
      if (!changes.added.includes(id)) mark('updated', id)
      return
    }
    if (op.op === 'annotate') {
      s = { ...s, annotations: [...s.annotations.filter((a) => a.id !== id), { id, text: op.text }] }
      mark('annotated', id)
      return
    }
    // remove, with its dependants: edges/messages/transitions lose their endpoint; group members are ungrouped.
    const gone = new Set([id])
    const elements: ModelElement[] = []
    for (const e of s.elements) {
      if (e === cur) continue
      if (refsOf(e).some(([ref]) => gone.has(ref)) && (e.type === 'edge' || e.type === 'message' || e.type === 'transition')) {
        gone.add(e.item.id)
        continue
      }
      if (e.type === 'node' && e.item.group === id) {
        const { group: _g, ...item } = e.item
        elements.push({ type: 'node', item })
        if (!changes.added.includes(e.item.id)) mark('updated', e.item.id)
      } else if (e.type === 'group' && e.item.parent === id) {
        const { parent: _p, ...item } = e.item
        elements.push({ type: 'group', item })
        if (!changes.added.includes(e.item.id)) mark('updated', e.item.id)
      } else elements.push(e)
    }
    s = { ...s, elements, annotations: s.annotations.filter((a) => !gone.has(a.id)) }
    for (const g of gone) {
      for (const list of ['added', 'updated', 'annotated'] as const) changes[list] = changes[list].filter((x) => x !== g)
      mark('removed', g)
    }
  })
  return { state: s, changes, issues }
}

/**
 * State of a model after every non-stale patch with `sectionOrdinal ≤ uptoOrdinal`, in order, plus what each
 * patch added, updated and removed (§13). Stale patches failed re-validation and are skipped until regenerated.
 */
export function applyPatches(model: ConceptModel, uptoOrdinal = Number.POSITIVE_INFINITY): { state: ModelState; patches: AppliedPatch[] } {
  let state = emptyState(model.kind)
  const patches: AppliedPatch[] = []
  for (const p of model.patches) {
    if (p.sectionOrdinal > uptoOrdinal) break
    if (p.stale) continue
    const r = applyOps(state, p.ops)
    state = r.state
    patches.push({ patchId: p.patchId, sectionId: p.sectionId, sectionOrdinal: p.sectionOrdinal, ...r.changes, issues: r.issues })
  }
  return { state, patches }
}

export type ModelIR = GraphIR | SequenceIR | StateIR

/** The state as a renderable IR (no size caps: concept models may outgrow the extractor limits). */
export function toIR(state: ModelState, title: string, direction: GraphIR['direction'] = 'LR'): ModelIR {
  const of = <T extends ElementType>(type: T) => state.elements.filter((e) => e.type === type).map((e) => e.item as ItemOf[T])
  if (state.kind === 'graph') return { type: 'graph', title, direction, nodes: of('node'), edges: of('edge'), groups: of('group') }
  if (state.kind === 'sequence') return { type: 'sequence', title, participants: of('participant'), messages: of('message') }
  const states = of('state')
  return { type: 'state', title, initial: states[0]?.id ?? '', final: [], states, transitions: of('transition') }
}

/**
 * Compact JSON of a state for the patcher (§7 slot 7): ids, labels and endpoints, no evidence. Annotations
 * keep `op: 'annotate'` so the packer can drop the oldest ones first.
 */
export function compactState(state: ModelState): unknown {
  const pick = (e: ModelElement) => {
    const { evidence: _e, ...rest } = e.item
    return rest
  }
  const of = (type: ElementType) => state.elements.filter((e) => e.type === type).map(pick)
  const lists =
    state.kind === 'graph'
      ? { nodes: of('node'), edges: of('edge'), groups: of('group') }
      : state.kind === 'sequence'
        ? { participants: of('participant'), messages: of('message') }
        : { states: of('state'), transitions: of('transition') }
  return { kind: state.kind, ...lists, annotations: state.annotations.map((a) => ({ op: 'annotate', ...a })) }
}

/** `PackInput.conceptModelState` for `@illus/context` (§7 slot 7): the state before `beforeOrdinal`. */
export function conceptModelState(model: ConceptModel, beforeOrdinal: number): unknown {
  return compactState(applyPatches(model, beforeOrdinal - 1).state)
}
