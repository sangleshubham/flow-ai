// The graph diagram language (ADR 0049): a short Eraser-style text the graph extractor writes instead of
// GraphIR JSON. Pure and total: never throws, reports problems as `schema`-layer issues with line numbers
// so the pipeline's retry can quote them back to the model. The result still goes through `validate`.
//
//   title Log replication
//   direction down                                   (down | right; TB | LR also accepted)
//   Client [icon: user, shape: actor] @b0 "The leader accepts client requests"
//   Cluster [icon: servers] @b1 "every follower" {   (a group; nodes inside belong to it)
//     Follower [sublabel: "copies the log"] @b1 "sends AppendEntries messages to every follower"
//   }
//   Client > Leader: request @b0 "The leader accepts client requests"
//   Follower --> Leader: success flag @b2 "replies to the leader"     (--> dashed; < and <-- reversed)
//
// `@ref` is a block id or its `#bN` suffix. A node without a quote borrows its first edge's evidence; an
// edge endpoint never declared becomes a box grounded by that edge.
import type { Evidence, IrId } from '../schemas/common.ts'
import { isGraphIcon } from '../schemas/icons.ts'
import { GraphColor } from '../schemas/ir.ts'
import type { GraphEdge, GraphGroup, GraphIR, GraphNode, GraphNodeShape } from '../schemas/ir.ts'
import type { ValidationIssue } from '../schemas/quality.ts'

export interface ParsedGraphSource {
  /** The candidate IR (not yet validated), or undefined when the source has no nodes. */
  ir: GraphIR | undefined
  issues: ValidationIssue[]
}

const SHAPES: Record<string, GraphNodeShape> = {
  box: 'box',
  rectangle: 'box',
  store: 'store',
  database: 'store',
  cylinder: 'store',
  actor: 'actor',
  person: 'actor',
  user: 'actor',
  queue: 'queue',
  decision: 'decision',
  diamond: 'decision',
  note: 'note',
}

const DIRECTIONS: Record<string, GraphIR['direction']> = { down: 'TB', tb: 'TB', up: 'TB', right: 'LR', lr: 'LR', left: 'LR' }

interface Ev {
  ref: string
  quote: string
}
interface NodeStmt {
  kind: 'node'
  line: number
  name: string
  attrs: Map<string, string>
  ev?: Ev
  group?: string
  bare: boolean
}
interface GroupStmt {
  kind: 'group'
  line: number
  name: string
  attrs: Map<string, string>
  ev?: Ev
  parent?: string
}
interface EdgeStmt {
  kind: 'edge'
  line: number
  from: string
  to: string
  label?: string
  dashed: boolean
  attrs: Map<string, string>
  ev?: Ev
}
type Stmt = NodeStmt | GroupStmt | EdgeStmt

const EVIDENCE = /@(\S+)\s+"((?:[^"\\]|\\.)*)"\s*$/
const BAD_CONNECTOR = /<->|<>|(^|\s)--?(\s|$)/

const keyOf = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
const unquote = (s: string) => {
  const t = s.trim()
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/\\(.)/g, '$1') : t
}

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44)
    .replace(/-+$/, '')
  return s || 'n'
}

/** Splits `a: 1, b: "x, y"` on commas outside quotes. */
function splitAttrs(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (ch === '\\' && quoted) {
      cur += ch + (s[i + 1] ?? '')
      i++
    } else if (ch === '"') {
      quoted = !quoted
      cur += ch
    } else if (ch === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}

/**
 * Parses the graph diagram language into a candidate `GraphIR`. `blocks` (the validation context's
 * blocks) resolve `@b0`-style refs; an ambiguous suffix picks the block whose text holds the quote.
 */
export function parseGraphSource(source: string, blocks: ReadonlyMap<string, { text: string }>): ParsedGraphSource {
  const issues: ValidationIssue[] = []
  const issue = (severity: 'error' | 'warning', code: string, line: number, message: string, elementId?: string) =>
    issues.push({ layer: 'schema', severity, code, message: `line ${line}: ${message}`, ...(elementId && { elementId }) })

  let title: string | undefined
  let direction: GraphIR['direction'] = 'TB'
  const stmts: Stmt[] = []
  const open: GroupStmt[] = []

  const lines = source.split(/\r?\n/)
  lines.forEach((raw, i) => {
    const n = i + 1
    let t = raw.trim()
    if (!t || t.startsWith('//') || t.startsWith('#')) return
    if (t === '}') {
      if (!open.pop()) issue('error', 'dsl-syntax', n, 'a "}" with no open group')
      return
    }
    const kw = /^(title|direction)\b\s*(.*)$/i.exec(t)
    if (kw && !/[>[@{]/.test(kw[2]!)) {
      const value = unquote(kw[2]!)
      if (kw[1]!.toLowerCase() === 'title') {
        if (value) title = value
      } else {
        const d = DIRECTIONS[value.toLowerCase()]
        if (d) direction = d
        else issue('warning', 'dsl-unknown-direction', n, `unknown direction "${value}"; use down or right`)
      }
      return
    }

    const opens = t.endsWith('{')
    if (opens) t = t.slice(0, -1).trimEnd()

    let ev: Ev | undefined
    const m = EVIDENCE.exec(t)
    if (m) {
      ev = { ref: m[1]!, quote: m[2]!.replace(/\\(.)/g, '$1') }
      t = t.slice(0, m.index).trimEnd()
    }
    if (t.includes('@') && !/"[^"]*@[^"]*"/.test(t)) {
      issue('error', 'dsl-syntax', n, 'evidence must be written as @<block id> "<verbatim quote>" at the end of the line')
      return
    }

    const attrs = new Map<string, string>()
    const lb = t.indexOf('[')
    if (lb >= 0 || t.includes(']')) {
      if (lb < 0 || !t.endsWith(']')) {
        issue('error', 'dsl-syntax', n, 'attributes must be one [key: value, …] list before the evidence')
        return
      }
      for (const pair of splitAttrs(t.slice(lb + 1, -1))) {
        const c = pair.indexOf(':')
        if (c <= 0) {
          issue('warning', 'dsl-unknown-attr', n, `ignored attribute "${pair}"; write key: value`)
          continue
        }
        attrs.set(pair.slice(0, c).trim().toLowerCase(), unquote(pair.slice(c + 1)))
      }
      t = t.slice(0, lb).trimEnd()
    }

    if (BAD_CONNECTOR.test(t)) {
      issue('error', 'dsl-bad-connector', n, 'connect with > (or --> for a dashed arrow); lines without arrows are not supported')
      return
    }
    const conn = /<--|-->|<|>/.exec(t)
    if (conn) {
      if (opens) {
        issue('error', 'dsl-syntax', n, 'a connection cannot open a group')
        return
      }
      const left = t.slice(0, conn.index).trim()
      let right = t.slice(conn.index + conn[0].length)
      let label: string | undefined
      const colon = right.indexOf(':')
      if (colon >= 0) {
        label = unquote(right.slice(colon + 1)) || undefined
        right = right.slice(0, colon)
      }
      right = right.trim()
      if (!left || !right || /[<>]/.test(right)) {
        issue('error', 'dsl-syntax', n, 'a connection is "From > To: label"; one arrow per line')
        return
      }
      const reversed = conn[0].startsWith('<')
      stmts.push({
        kind: 'edge',
        line: n,
        from: reversed ? right : left,
        to: reversed ? left : right,
        ...(label && { label }),
        dashed: conn[0].length === 3,
        attrs,
        ...(ev && { ev }),
      })
      return
    }

    const name = unquote(t)
    if (!name) {
      issue('error', 'dsl-syntax', n, 'expected a node name')
      return
    }
    const parent = open.at(-1)?.name
    if (opens) {
      const g: GroupStmt = { kind: 'group', line: n, name, attrs, ...(ev && { ev }), ...(parent && { parent }) }
      stmts.push(g)
      open.push(g)
    } else {
      stmts.push({ kind: 'node', line: n, name, attrs, ...(ev && { ev }), ...(parent && { group: parent }), bare: !ev && attrs.size === 0 })
    }
  })
  for (const g of open) issue('error', 'dsl-syntax', g.line, `group "${g.name}" is never closed with "}"`)

  // ---- resolve
  const used = new Set<string>()
  const newId = (name: string): IrId => {
    const base = slug(name)
    let id = base
    for (let k = 2; used.has(id); k++) id = `${base}-${k}`
    used.add(id)
    return id
  }
  const resolveEvidence = (ev: Ev | undefined, line: number): Evidence | undefined | 'bad' => {
    if (!ev) return undefined
    const ref = ev.ref.replace(/^#/, '')
    let blockId: string | undefined = blocks.has(ref) ? ref : undefined
    if (!blockId) {
      const cands = [...blocks.keys()].filter((id) => id.endsWith(`#${ref}`))
      const q = norm(ev.quote)
      blockId = cands.find((id) => norm(blocks.get(id)!.text).includes(q)) ?? cands[0]
    }
    if (!blockId) {
      issue('error', 'dsl-unknown-block', line, `no block "${ev.ref}"; use an id from the input`)
      return 'bad'
    }
    return { blockId, quote: ev.quote }
  }

  const groups = new Map<string, GraphGroup & { line: number }>()
  const nodes = new Map<string, Partial<GraphNode> & { id: string; label: string; shape: GraphNodeShape; line: number; dead?: true }>()
  const applyCommon = (target: { icon?: string; color?: GraphColor }, attrs: Map<string, string>, line: number) => {
    const icon = attrs.get('icon')
    if (icon !== undefined) {
      const name = icon.toLowerCase()
      if (isGraphIcon(name)) target.icon = name
      else issue('warning', 'dsl-unknown-icon', line, `unknown icon "${icon}" was dropped`)
    }
    const color = attrs.get('color') ?? attrs.get('colour')
    if (color !== undefined) {
      const c = GraphColor.safeParse(color.toLowerCase())
      if (c.success) target.color = c.data
      else issue('warning', 'dsl-unknown-color', line, `unknown colour "${color}" was dropped`)
    }
  }

  for (const s of stmts) {
    if (s.kind !== 'group') continue
    const key = keyOf(s.name)
    if (groups.has(key)) {
      issue('warning', 'dsl-duplicate', s.line, `group "${s.name}" is declared twice; the first is kept`)
      continue
    }
    const g: GraphGroup & { line: number } = { id: newId(s.name), label: s.name, line: s.line, evidence: undefined as never }
    const parent = s.parent !== undefined ? groups.get(keyOf(s.parent)) : undefined
    if (parent) g.parent = parent.id
    applyCommon(g, s.attrs, s.line)
    for (const k of s.attrs.keys()) if (k !== 'icon' && k !== 'color' && k !== 'colour') issue('warning', 'dsl-unknown-attr', s.line, `ignored attribute "${k}"`)
    const ev = resolveEvidence(s.ev, s.line)
    if (ev !== 'bad' && ev) g.evidence = ev
    groups.set(key, g)
  }

  for (const s of stmts) {
    if (s.kind !== 'node') continue
    const key = keyOf(s.name)
    if (groups.has(key)) {
      issue('error', 'dsl-syntax', s.line, `"${s.name}" is already a group name`)
      continue
    }
    const group = s.group !== undefined ? groups.get(keyOf(s.group))?.id : undefined
    const existing = nodes.get(key)
    if (existing) {
      if (s.bare) {
        if (group) existing.group = group
      } else issue('warning', 'dsl-duplicate', s.line, `"${s.name}" is declared twice; the first is kept`, existing.id)
      continue
    }
    const node: Partial<GraphNode> & { id: string; label: string; shape: GraphNodeShape; line: number; dead?: true } = {
      id: newId(s.name),
      label: s.name,
      shape: 'box',
      line: s.line,
    }
    if (group) node.group = group
    const shape = s.attrs.get('shape')
    if (shape !== undefined) {
      const sh = SHAPES[shape.toLowerCase()]
      if (sh) node.shape = sh
      else issue('warning', 'dsl-unknown-shape', s.line, `unknown shape "${shape}"; drawn as a box`, node.id)
    }
    const sub = s.attrs.get('sublabel') ?? s.attrs.get('sub')
    if (sub) node.sublabel = sub
    applyCommon(node, s.attrs, s.line)
    for (const k of s.attrs.keys())
      if (!['shape', 'sublabel', 'sub', 'icon', 'color', 'colour'].includes(k)) issue('warning', 'dsl-unknown-attr', s.line, `ignored attribute "${k}"`, node.id)
    const ev = resolveEvidence(s.ev, s.line)
    if (ev === 'bad') node.dead = true
    else if (ev) node.evidence = ev
    nodes.set(key, node)
  }

  const edges: GraphEdge[] = []
  for (const s of stmts) {
    if (s.kind !== 'edge') continue
    const ends = [s.from, s.to]
    if (ends.some((e) => groups.has(keyOf(e)))) {
      issue('error', 'dsl-group-edge', s.line, 'connect nodes, not groups')
      continue
    }
    const ev = resolveEvidence(s.ev, s.line)
    if (ev === 'bad') continue
    if (!ev) {
      issue('error', 'dsl-missing-evidence', s.line, `the connection ${s.from} > ${s.to} needs @<block> "<quote>"`)
      continue
    }
    const ids = ends.map((name) => {
      let node = nodes.get(keyOf(name))
      if (!node) {
        node = { id: newId(name), label: name, shape: 'box', line: s.line, evidence: ev }
        nodes.set(keyOf(name), node)
        issue('warning', 'dsl-implicit-node', s.line, `"${name}" was not declared; drawn as a box quoting this connection`, node.id)
      } else if (!node.evidence && !node.dead) {
        node.evidence = ev
        issue('warning', 'dsl-borrowed-evidence', node.line, `"${node.label}" has no quote; it uses the quote of its connection on line ${s.line}`, node.id)
      }
      return node.id
    })
    const style = s.attrs.get('style')?.toLowerCase()
    edges.push({
      id: `e${edges.length + 1}`,
      from: ids[0]!,
      to: ids[1]!,
      ...(s.label && { label: s.label }),
      style: s.dashed || style === 'dashed' || style === 'dotted' ? 'dashed' : 'solid',
      evidence: ev,
    })
  }

  const kept = [...nodes.values()].filter((n) => {
    if (n.dead) return false
    if (!n.evidence) {
      issue('error', 'dsl-missing-evidence', n.line, `"${n.label}" needs @<block> "<quote>"`, n.id)
      return false
    }
    return true
  })
  const keptIds = new Set(kept.map((n) => n.id))
  const finalEdges = edges.filter((e) => keptIds.has(e.from) && keptIds.has(e.to))

  // A group without its own quote borrows its first member's (warning); with none, it is dropped.
  const finalGroups: GraphGroup[] = []
  for (const g of groups.values()) {
    const { line, ...group } = g
    if (!group.evidence) {
      const member = kept.find((n) => n.group === g.id)
      if (!member) {
        issue('error', 'dsl-missing-evidence', line, `group "${g.label}" needs @<block> "<quote>"`, g.id)
        continue
      }
      group.evidence = member.evidence!
      issue('warning', 'dsl-borrowed-evidence', line, `group "${g.label}" has no quote; it uses its first member's`, g.id)
    }
    finalGroups.push(group)
  }
  const groupIds = new Set(finalGroups.map((g) => g.id))
  for (const g of finalGroups) if (g.parent && !groupIds.has(g.parent)) delete g.parent

  const lineOf = (i: ValidationIssue) => Number(/^line (\d+)/.exec(i.message)?.[1] ?? Infinity)
  issues.sort((a, b) => lineOf(a) - lineOf(b))

  if (kept.length === 0) {
    if (!issues.some((i) => i.severity === 'error')) issues.push({ layer: 'schema', severity: 'error', code: 'dsl-empty', message: 'the diagram has no nodes' })
    return { ir: undefined, issues }
  }
  if (!title) issues.push({ layer: 'schema', severity: 'warning', code: 'dsl-no-title', message: 'no "title" line; using "Diagram"' })

  return {
    ir: {
      type: 'graph',
      title: title ?? 'Diagram',
      direction,
      nodes: kept.map(({ line: _l, dead: _d, ...n }) => {
        if (n.group && !groupIds.has(n.group)) delete n.group
        return n as GraphNode
      }),
      edges: finalEdges,
      groups: finalGroups,
    },
    issues,
  }
}

const quote = (q: string) => `"${q.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const evidenceOf = (e: Evidence) => `@${e.blockId} ${quote(e.quote)}`

/**
 * Writes a `GraphIR` in the graph diagram language, with full block ids. The inverse of
 * `parseGraphSource` when labels are unique and ids are the slugs of the labels (test fixtures, repair).
 */
export function printGraphSource(ir: GraphIR): string {
  const attrs = (pairs: [string, string | undefined][]) => {
    const kept = pairs.filter((p): p is [string, string] => p[1] !== undefined)
    return kept.length ? ` [${kept.map(([k, v]) => `${k}: ${/[,\]"]/.test(v) || k === 'sublabel' ? quote(v) : v}`).join(', ')}]` : ''
  }
  const node = (n: GraphNode, indent: string): string =>
    `${indent}${n.label}${attrs([
      ['icon', n.icon],
      ['shape', n.shape === 'box' ? undefined : n.shape],
      ['sublabel', n.sublabel],
      ['color', n.color],
    ])} ${evidenceOf(n.evidence)}`
  const lines = [`title ${ir.title}`, `direction ${ir.direction === 'LR' ? 'right' : 'down'}`]
  // Nodes first, in IR order (ELK keeps model order); groups then list their members by name.
  for (const n of ir.nodes) lines.push(node(n, ''))
  const groupIds = new Set(ir.groups.map((g) => g.id))
  const walk = (parent: string | undefined, indent: string) => {
    for (const g of ir.groups.filter((x) => (x.parent && groupIds.has(x.parent) ? x.parent : undefined) === parent)) {
      lines.push(`${indent}${g.label}${attrs([['icon', g.icon], ['color', g.color]])} ${evidenceOf(g.evidence)} {`)
      walk(g.id, `${indent}  `)
      for (const n of ir.nodes.filter((x) => x.group === g.id)) lines.push(`${indent}  ${n.label}`)
      lines.push(`${indent}}`)
    }
  }
  walk(undefined, '')
  const labelOf = new Map(ir.nodes.map((n) => [n.id, n.label]))
  for (const e of ir.edges)
    lines.push(
      `${labelOf.get(e.from) ?? e.from} ${e.style === 'dashed' ? '-->' : '>'} ${labelOf.get(e.to) ?? e.to}${e.label ? `: ${e.label}` : ''} ${evidenceOf(e.evidence)}`,
    )
  return lines.join('\n')
}
