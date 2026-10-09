// Per-kind grounding walk and structural rules (§16 "Structural rules"). Each rule receives a parsed,
// cloned IR and returns the IR to keep. Auto-fixes only remove or reorder; they never invent content.
import type { IrKind, IrOf } from '../schemas/ir.ts'

import type { Checker } from './checker.ts'

type Rule<K extends IrKind> = (ir: IrOf<K>, c: Checker) => IrOf<K>

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  return [...new Set(ids.filter((id) => seen.has(id) || !seen.add(id)))]
}

function uniqueIds(c: Checker, what: string, ids: readonly string[]): void {
  for (const id of duplicates(ids)) c.error('duplicate-id', `${what} id "${id}" is used more than once`, id)
}

function tooFew(c: Checker, have: number, min: number, what: string): void {
  if (have < min) c.error('too-few-elements', `only ${have} ${what} left; at least ${min} needed`)
}

/**
 * Drops connections whose endpoint was dropped during grounding (they dangle) and reports endpoints that
 * never existed (a structural error the `repair` role may fix).
 */
function connect<T extends { id: string; from: string; to: string }>(
  c: Checker,
  items: T[],
  original: ReadonlySet<string>,
  kept: ReadonlySet<string>,
  what: string,
): T[] {
  return items.filter((e) => {
    for (const end of [e.from, e.to]) {
      if (kept.has(end)) continue
      if (original.has(end)) {
        c.drop(e.id, 'dangling', `${what} ${e.id} dropped: endpoint "${end}" was dropped`)
        return false
      }
      c.error(`${what}-endpoint-missing`, `${what} ${e.id} points at unknown "${end}"`, e.id)
    }
    return true
  })
}

const ids = <T extends { id: string }>(xs: readonly T[]) => new Set(xs.map((x) => x.id))
const pair = (labels: ReadonlyMap<string, string>, e: { from: string; to: string }) =>
  `${labels.get(e.from) ?? e.from} ${labels.get(e.to) ?? e.to}`

const graph: Rule<'graph'> = (ir, c) => {
  const labels = new Map(ir.nodes.map((n) => [n.id, n.label]))
  const nodes = c.keep(ir.nodes, (n) => n.id, (n) => n.label)
  const groups = c.keep(ir.groups, (g) => g.id, (g) => g.label)
  // An edge without a label is about its endpoints. Self-loops need evidence (§16): every surviving edge
  // has grounded evidence, because ungrounded ones were just dropped.
  let edges = c.keep(ir.edges, (e) => e.id, (e) => e.label ?? pair(labels, e))
  edges = connect(c, edges, ids(ir.nodes), ids(nodes), 'edge')

  const groupIds = ids(groups)
  const originalGroups = ids(ir.groups)
  const unlink = (ref: string | undefined, owner: string): boolean => {
    if (ref === undefined || groupIds.has(ref)) return false
    const why = originalGroups.has(ref) ? 'was dropped' : 'does not exist'
    c.fixed('group-missing', `${owner}: group "${ref}" ${why}; membership removed`, owner)
    return true
  }
  for (const n of nodes) if (unlink(n.group, n.id)) delete n.group
  for (const g of groups) if (unlink(g.parent, g.id)) delete g.parent

  const parent = new Map(groups.map((g) => [g.id, g.parent]))
  for (const g of groups) {
    const seen = new Set<string>()
    for (let at: string | undefined = g.id; at !== undefined; at = parent.get(at)) {
      if (seen.has(at)) {
        c.error('group-cycle', `group nesting of "${g.id}" is cyclic`, g.id)
        break
      }
      seen.add(at)
    }
  }

  uniqueIds(c, 'node or group', [...nodes.map((n) => n.id), ...groups.map((g) => g.id)])
  uniqueIds(c, 'edge', edges.map((e) => e.id))
  for (const l of duplicates(nodes.map((n) => n.label.trim().toLowerCase())))
    c.error('duplicate-label', `node label "${l}" is used more than once`)
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]))
  const isolated = nodes.filter((n) => !linked.has(n.id))
  if (isolated.length > 2)
    c.error('isolated-nodes', `${isolated.length} nodes have no edges (at most 2): ${isolated.map((n) => n.id).join(', ')}`)
  tooFew(c, nodes.length, 2, 'nodes')
  return { ...ir, nodes, groups, edges }
}

const sequence: Rule<'sequence'> = (ir, c) => {
  const labels = new Map(ir.participants.map((p) => [p.id, p.label]))
  let participants = c.keep(ir.participants, (p) => p.id, (p) => p.label)
  let messages = c.keep(ir.messages, (m) => m.id, (m) => `${m.label} ${pair(labels, m)}`)
  messages = connect(c, messages, ids(ir.participants), ids(participants), 'message')
  const used = new Set(messages.flatMap((m) => [m.from, m.to]))
  participants = participants.filter((p) => {
    if (used.has(p.id)) return true
    c.fixed('participant-unused', `participant ${p.id} sends or receives no message; removed`, p.id)
    return false
  })
  uniqueIds(c, 'participant', participants.map((p) => p.id))
  uniqueIds(c, 'message', messages.map((m) => m.id))
  tooFew(c, messages.length, 1, 'messages')
  return { ...ir, participants, messages }
}

const state: Rule<'state'> = (ir, c) => {
  const labels = new Map(ir.states.map((s) => [s.id, s.label]))
  const states = c.keep(ir.states, (s) => s.id, (s) => s.label)
  let transitions = c.keep(ir.transitions, (t) => t.id, (t) => `${t.event} ${pair(labels, t)}`)
  transitions = connect(c, transitions, ids(ir.states), ids(states), 'transition')
  const kept = ids(states)

  for (const t of transitions)
    if (!t.event.trim()) c.error('transition-event-missing', `transition ${t.id} names no event`, t.id)
  if (!kept.has(ir.initial)) c.error('initial-missing', `initial state "${ir.initial}" does not exist`, ir.initial)
  const final = ir.final.filter((f) => {
    if (kept.has(f)) return true
    c.fixed('final-missing', `final state "${f}" does not exist; removed from final`, f)
    return false
  })
  if (kept.has(ir.initial)) {
    const reached = new Set([ir.initial])
    const queue = [ir.initial]
    for (const at of queue)
      for (const t of transitions)
        if (t.from === at && !reached.has(t.to)) {
          reached.add(t.to)
          queue.push(t.to)
        }
    for (const s of states)
      if (!reached.has(s.id)) c.warn('unreachable-state', `state ${s.id} cannot be reached from ${ir.initial}`, s.id)
  }
  uniqueIds(c, 'state', states.map((s) => s.id))
  uniqueIds(c, 'transition', transitions.map((t) => t.id))
  tooFew(c, states.length, 2, 'states')
  tooFew(c, transitions.length, 1, 'transitions')
  return { ...ir, states, transitions, final }
}

const klass: Rule<'class'> = (ir, c) => {
  const labels = new Map(ir.classes.map((k) => [k.id, k.label]))
  const classes = c.keep(ir.classes, (k) => k.id, (k) => k.label).map((k) => ({
    ...k,
    fields: c.keep(k.fields, (f) => `${k.id}.${f.name}`, (f) => f.name),
    methods: c.keep(k.methods, (m) => `${k.id}.${m.name}()`, (m) => m.name),
  }))
  let relations = c.keep(ir.relations, (r) => r.id, (r) => r.label ?? pair(labels, r))
  relations = connect(c, relations, ids(ir.classes), ids(classes), 'relation')
  uniqueIds(c, 'class', classes.map((k) => k.id))
  uniqueIds(c, 'relation', relations.map((r) => r.id))
  tooFew(c, classes.length, 1, 'classes')
  return { ...ir, classes, relations }
}

const er: Rule<'er'> = (ir, c) => {
  const labels = new Map(ir.entities.map((e) => [e.id, e.label]))
  const entities = c.keep(ir.entities, (e) => e.id, (e) => e.label).map((e) => ({
    ...e,
    attributes: c.keep(e.attributes, (a) => `${e.id}.${a.name}`, (a) => a.name),
  }))
  let relationships = c.keep(ir.relationships, (r) => r.id, (r) => `${r.label} ${pair(labels, r)}`)
  relationships = connect(c, relationships, ids(ir.entities), ids(entities), 'relationship')
  uniqueIds(c, 'entity', entities.map((e) => e.id))
  uniqueIds(c, 'relationship', relationships.map((r) => r.id))
  tooFew(c, entities.length, 1, 'entities')
  return { ...ir, entities, relationships }
}

const template: Rule<'template'> = (ir, c) => {
  // Template elements live inside template-specific props, so an ungrounded one cannot be removed
  // generically: its evidence entry is removed and the grounding error keeps the report failing, which
  // sends the IR to re-extraction or `repair` (ADR 0006).
  const evidence = ir.evidence.flatMap((te) => {
    const e = c.ground(te.path, undefined, te.evidence)
    if (typeof e !== 'string') return [{ ...te, evidence: e }]
    c.issue('grounding', 'error', 'template-element-ungrounded', e, te.path)
    return []
  })
  tooFew(c, evidence.length, 1, 'grounded template elements')
  const out = { ...ir, evidence }
  if (!c.ctx.templates) {
    c.warn('template-unchecked', 'no template registry given; props and invariants were not checked')
    return out
  }
  const spec = c.ctx.templates.getTemplate(ir.templateId)
  if (!spec) {
    c.error('template-unknown', `template "${ir.templateId}" is not registered`)
    return out
  }
  const props = spec.propsSchema.safeParse(ir.props)
  if (!props.success) {
    for (const i of props.error.issues) c.issue('schema', 'error', 'template-props', `props.${i.path.join('.')}: ${i.message}`)
    return out
  }
  for (const msg of spec.checkInvariants?.(props.data) ?? []) c.error('template-invariant', msg)
  return { ...out, props: props.data }
}

const chart: Rule<'chart'> = (ir, c) => {
  const series = c.keep(ir.series, (s) => s.name, (s) => s.name)
  if (ir.logY && ir.domain[0] <= 0) c.error('log-domain', `logY needs a positive domain, got [${ir.domain.join(', ')}]`)
  for (const name of duplicates(series.map((s) => s.name))) c.error('duplicate-series', `series name "${name}" is used more than once`, name)
  for (const s of series)
    if ((s.fn === undefined) === (s.points === undefined)) c.error('series-fn-xor-points', `series ${s.name} needs exactly one of fn or points`, s.name)
  tooFew(c, series.length, 1, 'series')
  return { ...ir, series }
}

const math: Rule<'math'> = (ir, c) => {
  const terms = c.keep(ir.terms, (t) => t.symbol, (t) => `${t.symbol} ${t.meaning}`)
  const source = c.ctx.blocks.get(ir.sourceBlockId)
  if (!source) c.error('source-block-missing', `formula block ${ir.sourceBlockId} is not among the permitted blocks`)
  else if (source.kind !== 'math') c.warn('source-block-not-math', `block ${ir.sourceBlockId} is a ${source.kind} block`)
  tooFew(c, terms.length, 1, 'terms')
  return { ...ir, terms }
}

const timeline: Rule<'timeline'> = (ir, c) => {
  let events = c.keep(ir.events, (e) => e.id, (e) => e.label)
  const lanes = ids(ir.lanes)
  for (const e of events) {
    if (!lanes.has(e.lane)) c.error('lane-missing', `event ${e.id} is on unknown lane "${e.lane}"`, e.id)
    if (e.to !== undefined && !lanes.has(e.to)) c.error('message-target-missing', `event ${e.id} targets unknown lane "${e.to}"`, e.id)
  }
  const sorted = [...events].sort((a, b) => a.at - b.at)
  if (sorted.some((e, i) => e !== events[i])) {
    c.fixed('events-reordered', 'events were sorted by `at`')
    events = sorted
  }
  for (const lane of lanes) {
    const ats = events.filter((e) => e.lane === lane).map((e) => e.at)
    for (let i = 1; i < ats.length; i++)
      if (ats[i] === ats[i - 1]) c.error('at-not-increasing', `two events on lane ${lane} share at = ${ats[i]}`)
  }
  uniqueIds(c, 'lane', ir.lanes.map((l) => l.id))
  uniqueIds(c, 'event', events.map((e) => e.id))
  tooFew(c, events.length, 1, 'events')
  return { ...ir, events }
}

const html: Rule<'html'> = (ir, c) => {
  c.warn('no-evidence', 'html fallback visuals carry no evidence and are labelled as such (§10)')
  return ir
}

export const RULES: { [K in IrKind]: Rule<K> } = { graph, sequence, state, class: klass, er, template, chart, math, timeline, html }
