import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import { addIssues, ground, needsReextract, validate } from '../src/index.ts'
import type { IrKind, TemplateRegistry, TemplateSpec, ValidationContext, ValidationReport } from '../src/index.ts'
import { buildIR, make, Q, SECTION_LEADERS_ID as L, sb, smallBookBlocks } from '../src/testing/index.ts'

const blocks = new Map(smallBookBlocks().map((b) => [b.blockId, b]))
const ctx = (o: Partial<ValidationContext> = {}): ValidationContext => ({ blocks, ground, ...o })
const BAD = { blockId: sb(L, 0), quote: 'nothing in the book says this at all' }
const codes = (r: ValidationReport, severity?: 'error' | 'warning') =>
  r.issues.filter((i) => !severity || i.severity === severity).map((i) => i.code)

describe('validate: valid factory IRs', () => {
  const kinds: IrKind[] = ['graph', 'sequence', 'state', 'class', 'er', 'template', 'chart', 'math', 'timeline']
  it.each(kinds)('%s passes with every element grounded and offsets filled', (kind) => {
    const { ir, report } = validate(kind, buildIR(kind), ctx())
    expect(codes(report, 'error')).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.counts.dropped).toBe(0)
    expect(report.groundingScore).toBeGreaterThanOrEqual(0.9)
    expect(JSON.stringify(ir)).toMatch(/"start":\d+,"end":\d+/)
  })

  it('does not mutate its input', () => {
    const input = make.graphIR()
    const copy = structuredClone(input)
    validate('graph', input, ctx())
    expect(input).toEqual(copy)
  })
})

describe('validate: schema (L1)', () => {
  it('reports Zod issues and returns the input unchanged', () => {
    const bad = { type: 'graph', title: 'x', direction: 'UP', nodes: [], edges: [], groups: [] }
    const { ir, report } = validate('graph', bad, ctx())
    expect(ir).toBe(bad)
    expect(report.ok).toBe(false)
    expect(report.issues[0]).toMatchObject({ layer: 'schema', code: 'schema' })
  })

  it('rejects an IR of another kind and the trace kind', () => {
    expect(validate('graph', make.sequenceIR(), ctx()).report.ok).toBe(false)
    expect(codes(validate('trace', {}, ctx()).report)).toEqual(['unsupported-kind'])
  })
})

describe('validate: grounding (L2)', () => {
  it('drops an ungrounded node and the edges that now dangle, and scores the rest', () => {
    const base = make.graphIR()
    const nodes = base.nodes.map((n) => (n.id === 'follower' ? { ...n, evidence: BAD } : n))
    const { ir, report } = validate('graph', { ...base, nodes }, ctx())
    expect(ir.nodes.map((n) => n.id)).toEqual(['client', 'leader', 'log'])
    expect(ir.edges.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(report.dropped).toEqual(['follower', 'e3', 'e4'])
    expect(report.counts).toMatchObject({ total: 8, grounded: 7, dropped: 3 })
    expect(report.groundingScore).toBeCloseTo(7 / 8)
    expect(report.ok).toBe(true) // drops are fixes, not errors
    expect(needsReextract(report)).toBe(true) // 3/8 > 30%
  })

  it('counts half-grounded elements as 0.5 and keeps them', () => {
    const base = make.graphIR()
    const nodes = base.nodes.map((n) => (n.id === 'log' ? { ...n, label: 'Snapshot' } : n))
    const { ir, report } = validate('graph', { ...base, nodes }, ctx())
    expect(ir.nodes).toHaveLength(4)
    expect(report.counts.halfGrounded).toBe(1)
    expect(report.groundingScore).toBeCloseTo(7.5 / 8)
    expect(codes(report, 'warning')).toContain('half-grounded')
  })

  it('uses glossary aliases for the relevance check', () => {
    const base = make.graphIR()
    const nodes = base.nodes.map((n) => (n.id === 'log' ? { ...n, label: 'Journal' } : n))
    const r = validate('graph', { ...base, nodes }, ctx({ aliases: new Map([['log', ['journal']]]) })).report
    expect(r.counts.halfGrounded).toBe(0)
  })

  it('re-attributes and fuzzy-matches through the injected matcher', () => {
    const base = make.graphIR()
    const nodes = base.nodes.map((n) =>
      n.id === 'follower' ? { ...n, evidence: { blockId: sb(L, 0), quote: 'sends AppendEntry messages to every follower' } } : n,
    )
    const { ir, report } = validate('graph', { ...base, nodes }, ctx())
    expect(ir.nodes.find((n) => n.id === 'follower')!.evidence).toMatchObject({ blockId: sb(L, 1), fuzzy: true })
    expect(report.counts.fuzzy).toBe(1)
  })

  it('reports ungrounded template elements as errors (they cannot be removed generically)', () => {
    const ir = make.templateIR({ evidence: [{ path: 'values', evidence: BAD }, { path: 'pointers.0', evidence: Q.majorityLine }] })
    const r = validate('template', ir, ctx())
    expect(r.ir.evidence.map((e) => e.path)).toEqual(['pointers.0'])
    expect(codes(r.report, 'error')).toEqual(['template-element-ungrounded'])
  })
})

describe('validate: graph rules', () => {
  const g = make.graphIR()
  const node = (id: string, evidence = Q.request) => ({ id, label: id, shape: 'box' as const, evidence })

  it('errors on unknown edge endpoints, duplicate ids and duplicate labels', () => {
    const edges = [...g.edges, { ...g.edges[0]!, id: 'e9', to: 'ghost' }]
    const nodes = [...g.nodes, { ...g.nodes[1]!, id: 'leader2' }, { ...g.nodes[0]!, label: 'Other client' }]
    const r = validate('graph', { ...g, nodes, edges }, ctx()).report
    expect(codes(r, 'error')).toEqual(expect.arrayContaining(['edge-endpoint-missing', 'duplicate-id', 'duplicate-label']))
  })

  it('errors on more than 2 isolated nodes and on fewer than 2 nodes', () => {
    const nodes = [...g.nodes, node('leader-a'), node('leader-b'), node('leader-c')]
    expect(codes(validate('graph', { ...g, nodes }, ctx()).report)).toContain('isolated-nodes')
    const one = validate('graph', { ...g, nodes: [g.nodes[0]!], edges: [] }, ctx()).report
    expect(codes(one, 'error')).toContain('too-few-elements')
    expect(needsReextract(one)).toBe(true)
  })

  it('drops an ungrounded self-loop', () => {
    const edges = [...g.edges, { id: 'loop', from: 'leader', to: 'leader', style: 'solid' as const, evidence: BAD }]
    expect(validate('graph', { ...g, edges }, ctx()).report.dropped).toEqual(['loop'])
  })

  it('auto-fixes memberships of missing groups and errors on cyclic nesting', () => {
    const groups = [
      { id: 'g1', label: 'Cluster', parent: 'g2', evidence: Q.threeStates },
      { id: 'g2', label: 'Server', parent: 'g1', evidence: Q.threeStates },
    ]
    const nodes = g.nodes.map((n) => ({ ...n, group: n.id === 'client' ? 'nowhere' : undefined }))
    const { ir, report } = validate('graph', { ...g, nodes, groups }, ctx())
    expect(ir.nodes[0]!.group).toBeUndefined()
    expect(report.issues.find((i) => i.code === 'group-missing')).toMatchObject({ autoFixed: true, severity: 'warning' })
    expect(codes(report, 'error')).toContain('group-cycle')
  })
})

describe('validate: sequence rules', () => {
  const s = make.sequenceIR()

  it('removes unused participants (safe fix) and errors on unknown endpoints', () => {
    const participants = [...s.participants, { id: 'idle', label: 'Follower two', evidence: Q.followerAppends }]
    const messages = [...s.messages, { ...s.messages[0]!, id: 'm9', to: 'ghost' }]
    const { ir, report } = validate('sequence', { ...s, participants, messages }, ctx())
    expect(ir.participants.map((p) => p.id)).not.toContain('idle')
    expect(report.issues.find((i) => i.code === 'participant-unused')?.autoFixed).toBe(true)
    expect(codes(report, 'error')).toEqual(['message-endpoint-missing'])
  })

  it('cascades a dropped participant to its messages and errors when no message is left', () => {
    const participants = s.participants.map((p) => (p.id === 'leader' ? { ...p, evidence: BAD } : p))
    const { ir, report } = validate('sequence', { ...s, participants }, ctx())
    expect(ir.messages).toEqual([])
    expect(codes(report, 'error')).toContain('too-few-elements')
  })
})

describe('validate: state rules', () => {
  const s = make.stateIR()

  it('errors when the initial state is missing and on blank events; warns on unreachable states', () => {
    const transitions = [{ ...s.transitions[0]!, event: '   ' }]
    const r = validate('state', { ...s, initial: 'ghost', transitions }, ctx()).report
    expect(codes(r, 'error')).toEqual(expect.arrayContaining(['initial-missing', 'transition-event-missing']))
    const r2 = validate('state', { ...s, transitions: [s.transitions[0]!] }, ctx()).report
    expect(r2.issues.find((i) => i.code === 'unreachable-state')).toMatchObject({ severity: 'warning', elementId: 'leader' })
    expect(r2.ok).toBe(true)
  })

  it('removes unknown final states', () => {
    const { ir, report } = validate('state', { ...s, final: ['leader', 'ghost'] }, ctx())
    expect(ir.final).toEqual(['leader'])
    expect(report.ok).toBe(true)
  })
})

describe('validate: class and ER rules', () => {
  it('errors on unknown relation endpoints and drops ungrounded fields by path id', () => {
    const c = make.classIR()
    const classes = c.classes.map((k) => (k.id === 'LogEntry' ? { ...k, fields: [{ name: 'term', evidence: BAD }] } : k))
    const relations = [...c.relations, { ...c.relations[0]!, id: 'r2', to: 'Ghost' }]
    const { ir, report } = validate('class', { ...c, classes, relations }, ctx())
    expect(ir.classes[1]!.fields).toEqual([])
    expect(report.dropped).toEqual(['LogEntry.term'])
    expect(codes(report, 'error')).toEqual(['relation-endpoint-missing'])
  })

  it('errors on unknown ER relationship endpoints', () => {
    const e = make.erIR()
    const relationships = [{ ...e.relationships[0]!, from: 'ghost' }]
    expect(codes(validate('er', { ...e, relationships }, ctx()).report, 'error')).toEqual(['relationship-endpoint-missing'])
  })
})

describe('validate: chart, math, timeline rules', () => {
  it('chart: positive domain with logY, unique series names', () => {
    const c = make.chartIR()
    expect(codes(validate('chart', { ...c, logY: true, domain: [0, 9] }, ctx()).report, 'error')).toEqual(['log-domain'])
    const series = [c.series[0]!, { ...c.series[0]!, fn: 'log' as const }]
    expect(codes(validate('chart', { ...c, series }, ctx()).report, 'error')).toEqual(['duplicate-series'])
  })

  it('math: the formula block must be permitted', () => {
    expect(codes(validate('math', make.mathIR({ sourceBlockId: 'nope#b0' }), ctx()).report, 'error')).toEqual(['source-block-missing'])
  })

  it('timeline: lanes and targets exist, `at` strictly increasing per lane, out-of-order events re-sorted', () => {
    const t = make.timelineIR()
    const bad = [...t.events, { ...t.events[0]!, id: 'x1', lane: 'ghost' }, { ...t.events[1]!, id: 'x2', to: 'ghost' }]
    expect(codes(validate('timeline', { ...t, events: bad }, ctx()).report, 'error')).toEqual(
      expect.arrayContaining(['lane-missing', 'message-target-missing']),
    )
    const dup = [...t.events, { ...t.events[0]!, id: 'x3', at: 1 }]
    expect(codes(validate('timeline', { ...t, events: dup }, ctx()).report, 'error')).toEqual(['at-not-increasing'])
    const { ir, report } = validate('timeline', { ...t, events: [...t.events].reverse() }, ctx())
    expect(ir.events.map((e) => e.at)).toEqual([0, 1, 2])
    expect(report.issues.find((i) => i.code === 'events-reordered')?.autoFixed).toBe(true)
  })
})

describe('validate: template hook (W5 invariants)', () => {
  const props = z.object({
    values: z.array(z.number()),
    pointers: z.array(z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_']{0,11}$/), index: z.number().int() })).max(6).optional(),
  })
  const spec: TemplateSpec<z.infer<typeof props>> = {
    id: 'array',
    description: 'array',
    whenToUse: 'arrays',
    propsSchema: props,
    example: { values: [], pointers: [] },
    supportedActions: ['highlight'],
    checkInvariants: (p) =>
      (p.pointers ?? []).flatMap(({ name, index }) => (index >= -1 && index <= p.values.length ? [] : [`pointer ${name} out of range`])),
  }
  const templates: TemplateRegistry = {
    getTemplate: (id) => (id === 'array' ? (spec as TemplateSpec) : undefined),
    listTemplates: () => [spec as TemplateSpec],
  }

  it('checks props with the template schema and runs its invariants', () => {
    expect(validate('template', make.templateIR(), ctx({ templates })).report.ok).toBe(true)
    const outOfRange = make.templateIR({ props: { values: [1], pointers: [{ name: 'majority', index: 4 }] } })
    expect(codes(validate('template', outOfRange, ctx({ templates })).report, 'error')).toEqual(['template-invariant'])
    const badProps = make.templateIR({ props: { values: 'no' } })
    expect(codes(validate('template', badProps, ctx({ templates })).report, 'error')).toContain('template-props')
    expect(codes(validate('template', make.templateIR({ templateId: 'stack' }), ctx({ templates })).report)).toContain(
      'template-unknown',
    )
  })

  describe('dropElement', () => {
    const list = z.object({ items: z.array(z.string()), root: z.string() })
    class TemplateDropError extends Error {
      override name = 'TemplateDropError'
    }
    const dropSpec: TemplateSpec<z.infer<typeof list>> = {
      id: 'stack',
      description: 'stack',
      whenToUse: 'stacks',
      propsSchema: list,
      example: { items: [], root: 'r' },
      supportedActions: ['highlight'],
      checkInvariants: (p) => (p.items.length ? [] : ['empty']),
      dropElement(p, path) {
        const m = /^items\.(\d+)$/.exec(path)
        if (!m) throw new TemplateDropError(`stack: ${path} cannot be dropped`)
        return { ...p, items: p.items.filter((_, i) => i !== Number(m[1])) }
      },
    }
    const reg: TemplateRegistry = { getTemplate: () => dropSpec as TemplateSpec, listTemplates: () => [dropSpec as TemplateSpec] }
    const ir = (evidence: { path: string; evidence: typeof BAD }[]) =>
      make.templateIR({ templateId: 'stack', props: { items: ['a', 'b', 'c', 'd'], root: 'r' }, evidence })

    it('drops an ungrounded list element and renumbers later evidence paths', () => {
      const r = validate(
        'template',
        ir([
          { path: 'items.0', evidence: Q.majorityLine },
          { path: 'items.1', evidence: BAD },
          { path: 'items.3', evidence: BAD },
          { path: 'items.2', evidence: Q.majorityLine },
        ]),
        ctx({ templates: reg }),
      )
      expect(r.report.ok).toBe(true)
      expect(r.report.dropped).toEqual(['items.3', 'items.1'])
      expect(r.ir.props).toEqual({ items: ['a', 'c'], root: 'r' })
      expect(r.ir.evidence.map((e) => e.path)).toEqual(['items.0', 'items.1'])
    })

    it('keeps the grounding error when dropElement throws TemplateDropError', () => {
      let r: ReturnType<typeof validate<'template'>> | undefined
      expect(() => {
        r = validate('template', ir([{ path: 'items.0', evidence: Q.majorityLine }, { path: 'root', evidence: BAD }]), ctx({ templates: reg }))
      }).not.toThrow()
      expect(codes(r!.report, 'error')).toEqual(['template-element-ungrounded'])
      expect(r!.report.issues[0]?.elementId).toBe('root')
      expect(r!.report.dropped).toEqual([])
      expect(r!.ir.props).toEqual({ items: ['a', 'b', 'c', 'd'], root: 'r' })
    })
  })

  it('warns when no registry is available', () => {
    expect(codes(validate('template', make.templateIR(), ctx()).report, 'warning')).toContain('template-unchecked')
  })
})

describe('report helpers', () => {
  it('addIssues merges animation or render issues and recomputes ok', () => {
    const { report } = validate('graph', make.graphIR(), ctx())
    const merged = addIssues(report, [{ layer: 'animation', severity: 'error', code: 'unknown-target', message: 'node:x' }])
    expect(merged.ok).toBe(false)
    expect(addIssues(report, []).ok).toBe(true)
  })

  it('html visuals pass with a no-evidence warning', () => {
    const r = validate('html', make.htmlIR(), ctx()).report
    expect(r.ok).toBe(true)
    expect(codes(r)).toEqual(['no-evidence'])
  })
})
