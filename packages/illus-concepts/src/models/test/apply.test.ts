import { describe, expect, it } from 'vitest'

import type { ConceptModel, PatchOp } from '@illus/core'
import { Q, make } from '@illus/core/testing'

import { applyOps, applyPatches, compactState, conceptModelState, emptyState, toIR } from '../apply.ts'

const node = (id: string, extra: object = {}): PatchOp => ({ op: 'addNode', node: { id, label: id, shape: 'box', evidence: Q.request, ...extra } })
const edge = (id: string, from: string, to: string): PatchOp => ({ op: 'addEdge', edge: { id, from, to, style: 'solid', evidence: Q.request } })
const patch = (sectionOrdinal: number, ops: PatchOp[], extra: object = {}) =>
  make.patch({ patchId: `m@${sectionOrdinal}`, sectionId: `s${sectionOrdinal}`, sectionOrdinal, ops, ...extra })
const model = (...patches: ReturnType<typeof patch>[]): ConceptModel => make.conceptModel({ patches })

describe('applyOps', () => {
  it('adds, updates, annotates and reports changes', () => {
    const r = applyOps(emptyState('graph'), [
      { op: 'addGroup', group: { id: 'g', label: 'G', evidence: Q.request } },
      node('a', { group: 'g' }),
      node('b'),
      edge('e', 'a', 'b'),
      { op: 'update', id: 'b', label: 'Bee', evidence: Q.reply },
      { op: 'annotate', id: 'a', text: 'note', evidence: Q.reply },
    ])
    expect(r.issues).toEqual([])
    expect(r.changes).toEqual({ added: ['g', 'a', 'b', 'e'], updated: [], removed: [], annotated: ['a'] })
    const ir = toIR(r.state, 'T')
    expect(ir.type === 'graph' && ir.nodes.find((n) => n.id === 'b')).toMatchObject({ label: 'Bee', evidence: Q.reply })
    expect(r.state.annotations).toEqual([{ id: 'a', text: 'note' }])
  })

  it('skips ops that cannot apply and says why', () => {
    const r = applyOps(emptyState('graph'), [
      node('a'),
      node('a'),
      edge('e', 'a', 'zz'),
      { op: 'update', id: 'nope', label: 'x', evidence: Q.request },
      { op: 'addState', item: { id: 's', label: 'S', evidence: Q.request } },
      node('c', { group: 'missing' }),
    ])
    expect(r.issues.map((i) => i.code)).toEqual(['duplicate-id', 'unresolved-ref', 'unknown-id', 'wrong-kind', 'unresolved-ref'])
    expect(r.state.elements.map((e) => e.item.id)).toEqual(['a'])
  })

  it('remove cascades to edges and ungroups members', () => {
    const base = applyOps(emptyState('graph'), [
      { op: 'addGroup', group: { id: 'g', label: 'G', evidence: Q.request } },
      node('a', { group: 'g' }),
      node('b'),
      edge('e', 'a', 'b'),
      { op: 'annotate', id: 'e', text: 'x', evidence: Q.request },
    ]).state
    const r = applyOps(base, [
      { op: 'remove', id: 'b', evidence: Q.reply },
      { op: 'remove', id: 'g', evidence: Q.reply },
    ])
    expect(r.changes.removed).toEqual(['b', 'e', 'g'])
    expect(r.changes.updated).toEqual(['a'])
    expect(r.state.elements).toHaveLength(1)
    expect(r.state.elements[0]!.item).not.toHaveProperty('group')
    expect(r.state.annotations).toEqual([])
  })

  it('types ops per kind: sequence and state models', () => {
    const seq = applyOps(emptyState('sequence'), [
      { op: 'addParticipant', item: { id: 'c', label: 'Client', evidence: Q.request } },
      { op: 'addParticipant', item: { id: 'l', label: 'Leader', evidence: Q.request } },
      { op: 'addMessage', item: { id: 'm', from: 'c', to: 'l', label: 'request', kind: 'sync', evidence: Q.request } },
      { op: 'addNode', node: { id: 'x', label: 'x', shape: 'box', evidence: Q.request } },
    ])
    expect(seq.issues.map((i) => i.code)).toEqual(['wrong-kind'])
    expect(toIR(seq.state, 'S')).toMatchObject({ type: 'sequence', participants: [{ id: 'c' }, { id: 'l' }], messages: [{ id: 'm' }] })

    const st = applyOps(emptyState('state'), [
      { op: 'addState', item: { id: 'f', label: 'Follower', evidence: Q.threeStates } },
      { op: 'addState', item: { id: 'c', label: 'Candidate', evidence: Q.threeStates } },
      { op: 'addTransition', item: { id: 't', from: 'f', to: 'c', event: 'timeout', evidence: Q.noHeartbeat } },
      { op: 'update', id: 't', label: 'no heartbeat', evidence: Q.noHeartbeat },
    ])
    expect(st.issues).toEqual([])
    expect(toIR(st.state, 'S')).toMatchObject({ type: 'state', initial: 'f', final: [], transitions: [{ id: 't', event: 'no heartbeat' }] })
  })
})

describe('applyPatches', () => {
  it('applies patches up to an ordinal, in order, and skips stale ones', () => {
    const m = model(patch(1, [node('a')]), patch(2, [node('b')], { stale: true }), patch(3, [node('c'), edge('e', 'a', 'c')]))
    expect(applyPatches(m, 1).state.elements.map((e) => e.item.id)).toEqual(['a'])
    const all = applyPatches(m)
    expect(all.state.elements.map((e) => e.item.id)).toEqual(['a', 'c', 'e'])
    expect(all.patches.map((p) => [p.sectionOrdinal, p.added])).toEqual([[1, ['a']], [3, ['c', 'e']]])
  })

  it('is pure', () => {
    const m = model(patch(1, [node('a')]))
    const before = structuredClone(m)
    applyPatches(m)
    expect(m).toEqual(before)
  })

  it('compact state drops evidence and keeps annotations as annotate ops (slot 7)', () => {
    const m = model(patch(1, [node('a'), { op: 'annotate', id: 'a', text: 'hi', evidence: Q.request }]), patch(2, [node('b')]))
    expect(conceptModelState(m, 2)).toEqual({
      kind: 'graph',
      nodes: [{ id: 'a', label: 'a', shape: 'box' }],
      edges: [],
      groups: [],
      annotations: [{ op: 'annotate', id: 'a', text: 'hi' }],
    })
    expect(JSON.stringify(compactState(applyPatches(m).state))).not.toContain('evidence')
  })
})
