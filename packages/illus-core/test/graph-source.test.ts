import { describe, expect, it } from 'vitest'

import { GraphIR, parseGraphSource, printGraphSource } from '../src/index.ts'
import { make } from '../src/testing/index.ts'

const S = 'bk:2:5-log-replication:1'
const OTHER = 'bk:2:4-elections:1'
const blocks = new Map([
  [`${S}#b0`, { text: 'The leader accepts client requests and appends each command to its log as a new entry.' }],
  [`${S}#b1`, { text: 'The leader then sends AppendEntries messages to every follower in parallel.' }],
  [`${S}#b2`, { text: 'A follower appends the entries to its own log and replies to the leader with a success flag.' }],
  [`${OTHER}#b0`, { text: 'A candidate that receives votes from a majority becomes the leader.' }],
])

const RAFT = `
title Log replication
direction down

// nodes
Client [icon: user, shape: actor] @b0 "The leader accepts client requests"
Leader [icon: server] @b0 "The leader accepts client requests"
Log [icon: logs, shape: store] @b0 "appends each command to its log as a new entry"
Cluster [icon: servers, color: blue] @b1 "sends AppendEntries messages to every follower" {
  Follower [icon: server, sublabel: "copies the log"] @b1 "sends AppendEntries messages to every follower in parallel"
}

// edges
Client > Leader: request @b0 "The leader accepts client requests"
Leader > Log: append @b0 "appends each command to its log as a new entry"
Leader > Follower: AppendEntries @b1 "sends AppendEntries messages to every follower in parallel"
Follower --> Leader: success flag @b2 "replies to the leader with a success flag"
`

const errors = (r: ReturnType<typeof parseGraphSource>) => r.issues.filter((i) => i.severity === 'error')
const codes = (r: ReturnType<typeof parseGraphSource>) => r.issues.map((i) => i.code)

describe('parseGraphSource', () => {
  it('turns an Eraser-style source into a GraphIR', () => {
    const r = parseGraphSource(RAFT, blocks)
    expect(errors(r)).toEqual([])
    const ir = GraphIR.parse(r.ir)
    expect(ir.title).toBe('Log replication')
    expect(ir.direction).toBe('TB')
    expect(ir.nodes.map((n) => [n.id, n.label, n.shape, n.icon, n.group])).toEqual([
      ['client', 'Client', 'actor', 'user', undefined],
      ['leader', 'Leader', 'box', 'server', undefined],
      ['log', 'Log', 'store', 'logs', undefined],
      ['follower', 'Follower', 'box', 'server', 'cluster'],
    ])
    expect(ir.nodes[3]!.sublabel).toBe('copies the log')
    expect(ir.groups).toEqual([
      {
        id: 'cluster',
        label: 'Cluster',
        icon: 'servers',
        color: 'blue',
        evidence: { blockId: `${S}#b1`, quote: 'sends AppendEntries messages to every follower' },
      },
    ])
    expect(ir.edges.map((e) => [e.id, e.from, e.to, e.label, e.style])).toEqual([
      ['e1', 'client', 'leader', 'request', 'solid'],
      ['e2', 'leader', 'log', 'append', 'solid'],
      ['e3', 'leader', 'follower', 'AppendEntries', 'solid'],
      ['e4', 'follower', 'leader', 'success flag', 'dashed'],
    ])
    expect(ir.edges[3]!.evidence).toEqual({ blockId: `${S}#b2`, quote: 'replies to the leader with a success flag' })
  })

  it('accepts full block ids and resolves an ambiguous short ref by the block that holds the quote', () => {
    const r = parseGraphSource(
      `title T
Leader @${S}#b0 "The leader accepts client requests"
Candidate @b0 "A candidate that receives votes from a majority"`,
      blocks,
    )
    expect(errors(r)).toEqual([])
    const ir = GraphIR.parse(r.ir)
    expect(ir.nodes[0]!.evidence.blockId).toBe(`${S}#b0`)
    expect(ir.nodes[1]!.evidence.blockId).toBe(`${OTHER}#b0`)
  })

  it('maps directions and defaults to TB', () => {
    expect(GraphIR.parse(parseGraphSource('title T\ndirection right\nA @b0 "The leader accepts"', blocks).ir).direction).toBe('LR')
    expect(GraphIR.parse(parseGraphSource('title T\nA @b0 "The leader accepts"', blocks).ir).direction).toBe('TB')
    expect(GraphIR.parse(parseGraphSource('title T\ndirection LR\nA @b0 "The leader accepts"', blocks).ir).direction).toBe('LR')
  })

  it('supports reversed and dashed connectors and edge style attributes', () => {
    const r = parseGraphSource(
      `title T
A @b0 "The leader accepts"
B @b1 "sends AppendEntries messages"
A < B: pulls @b1 "sends AppendEntries messages"
A <-- B @b1 "sends AppendEntries messages"
A > B: maybe [style: dashed] @b1 "sends AppendEntries messages"
A-->B @b1 "sends AppendEntries messages"`,
      blocks,
    )
    expect(errors(r)).toEqual([])
    const ir = GraphIR.parse(r.ir)
    expect(ir.edges.map((e) => [e.from, e.to, e.label, e.style])).toEqual([
      ['b', 'a', 'pulls', 'solid'],
      ['b', 'a', undefined, 'dashed'],
      ['a', 'b', 'maybe', 'dashed'],
      ['a', 'b', undefined, 'dashed'],
    ])
  })

  it('creates an undeclared edge endpoint as a box grounded by the edge, with a warning', () => {
    const r = parseGraphSource(`title T\nLeader > Follower: AppendEntries @b1 "sends AppendEntries messages to every follower"`, blocks)
    expect(errors(r)).toEqual([])
    const ir = GraphIR.parse(r.ir)
    expect(ir.nodes.map((n) => [n.id, n.shape, n.evidence.quote])).toEqual([
      ['leader', 'box', 'sends AppendEntries messages to every follower'],
      ['follower', 'box', 'sends AppendEntries messages to every follower'],
    ])
    expect(codes(r).filter((c) => c === 'dsl-implicit-node')).toHaveLength(2)
  })

  it('lets a declared node without a quote borrow its first edge’s evidence', () => {
    const r = parseGraphSource(`title T\nLeader [icon: server]\nFollower @b1 "every follower"\nLeader > Follower @b1 "sends AppendEntries messages"`, blocks)
    expect(errors(r)).toEqual([])
    expect(GraphIR.parse(r.ir).nodes[0]!.evidence.quote).toBe('sends AppendEntries messages')
    expect(codes(r)).toContain('dsl-borrowed-evidence')
  })

  it('reports a node with no quote and no edges', () => {
    const r = parseGraphSource(`title T\nLeader [icon: server]`, blocks)
    expect(errors(r).map((i) => i.code)).toEqual(['dsl-missing-evidence'])
  })

  it('assigns an already declared node to a group listed by bare name, and nests groups', () => {
    const r = parseGraphSource(
      `title T
Leader @b0 "The leader accepts"
Outer @b1 "every follower" {
  Inner @b1 "every follower in parallel" {
    Leader
    Follower @b1 "every follower"
  }
}`,
      blocks,
    )
    expect(errors(r)).toEqual([])
    const ir = GraphIR.parse(r.ir)
    expect(ir.groups.map((g) => [g.id, g.parent])).toEqual([
      ['outer', undefined],
      ['inner', 'outer'],
    ])
    expect(ir.nodes.map((n) => [n.id, n.group])).toEqual([
      ['leader', 'inner'],
      ['follower', 'inner'],
    ])
  })

  it('keeps ids unique and slug-safe', () => {
    const r = parseGraphSource(
      `title T
Write-ahead log (WAL) @b0 "appends each command to its log"
write ahead log! @b0 "its log as a new entry"
Log @b0 "its log"
Log @b0 "its log as"`,
      blocks,
    )
    const ir = GraphIR.parse(r.ir)
    expect(ir.nodes.map((n) => n.id)).toEqual(['write-ahead-log-wal', 'write-ahead-log', 'log'])
    expect(codes(r)).toContain('dsl-duplicate')
  })

  it('drops unknown icons, shapes, colours and attributes with warnings', () => {
    const r = parseGraphSource(`title T\nA [icon: unicorn, shape: blob, color: teal, size: 3] @b0 "The leader accepts"`, blocks)
    expect(errors(r)).toEqual([])
    const n = GraphIR.parse(r.ir).nodes[0]!
    expect([n.icon, n.shape, n.color]).toEqual([undefined, 'box', undefined])
    expect(codes(r)).toEqual(expect.arrayContaining(['dsl-unknown-icon', 'dsl-unknown-shape', 'dsl-unknown-color', 'dsl-unknown-attr']))
  })

  it('understands shape aliases', () => {
    const r = parseGraphSource(`title T\nA [shape: database] @b0 "The leader"\nB [shape: diamond] @b0 "accepts"\nC [shape: person] @b0 "client"`, blocks)
    expect(GraphIR.parse(r.ir).nodes.map((n) => n.shape)).toEqual(['store', 'decision', 'actor'])
  })

  it('reports unknown block refs, edges to groups, bad connectors and syntax errors with line numbers', () => {
    const r = parseGraphSource(
      `title T
A @b9 "The leader accepts"
G @b1 "every follower" {
  B @b1 "every follower"
}
A > G @b1 "every follower"
A - B @b1 "every follower"
A [icon: server @b0 "x y z"
}`,
      blocks,
    )
    expect(errors(r).map((i) => [i.code, i.message.match(/^line (\d+)/)?.[1]])).toEqual([
      ['dsl-unknown-block', '2'],
      ['dsl-group-edge', '6'],
      ['dsl-bad-connector', '7'],
      ['dsl-syntax', '8'],
      ['dsl-syntax', '9'],
    ])
  })

  it('reports an unclosed group', () => {
    const r = parseGraphSource(`title T\nG @b1 "every follower" {\n  B @b1 "every follower"`, blocks)
    expect(errors(r).map((i) => i.code)).toEqual(['dsl-syntax'])
  })

  it('handles escaped quotes inside a quote', () => {
    const quoteBlocks = new Map([['x#b0', { text: 'The "leader" accepts requests.' }]])
    const r = parseGraphSource(`title T\nLeader @b0 "The \\"leader\\" accepts"`, quoteBlocks)
    expect(GraphIR.parse(r.ir).nodes[0]!.evidence.quote).toBe('The "leader" accepts')
  })

  it('falls back to a default title with a warning and returns no IR for an empty source', () => {
    const r = parseGraphSource('A @b0 "The leader accepts"', blocks)
    expect(GraphIR.parse(r.ir).title).toBe('Diagram')
    expect(codes(r)).toContain('dsl-no-title')
    const empty = parseGraphSource('// nothing here', blocks)
    expect(empty.ir).toBeUndefined()
    expect(errors(empty).map((i) => i.code)).toEqual(['dsl-empty'])
  })

  it('never throws on arbitrary input', () => {
    for (const s of ['', '{', '}', '>>', '[', '@', '"', 'a > > b', 'title', 'direction sideways', ']]][[', 'A [icon:] @ ""'])
      expect(() => parseGraphSource(s, blocks)).not.toThrow()
  })

  it('round-trips through printGraphSource', () => {
    const ir = make.graphIR()
    const withExtras: GraphIR = {
      ...ir,
      nodes: ir.nodes.map((n, i) => (i === 0 ? { ...n, icon: 'user', color: 'green', sublabel: 'sends, "requests"' } : n.id === 'follower' ? { ...n, group: 'cluster' } : n)),
      groups: [{ id: 'cluster', label: 'Cluster', icon: 'servers', evidence: ir.nodes[3]!.evidence }],
    }
    const allBlocks = new Map([...withExtras.nodes, ...withExtras.edges, ...withExtras.groups].map((x) => [x.evidence.blockId, { text: '' }]))
    for (const g of [ir, withExtras]) {
      const r = parseGraphSource(printGraphSource(g), allBlocks)
      expect(r.issues).toEqual([])
      expect(r.ir).toEqual(g)
    }
  })
})
