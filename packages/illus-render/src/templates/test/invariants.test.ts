// Template invariants (§10, §16 "Template" rule): accepted and rejected props per template, and dropElement.
import { describe, expect, it } from 'vitest'

import type { TemplateId } from '@illus/core'

import { getTemplate, TemplateDropError } from '../index.ts'

const t = (id: TemplateId) => getTemplate(id)!
/** Props after schema parse (so defaults and shapes are what validate() sees), then the invariants. */
const check = (id: TemplateId, props: unknown) => t(id).checkInvariants!(t(id).propsSchema.parse(props))
const ex = (id: TemplateId) => structuredClone(t(id).example) as Record<string, unknown>

const bin = (nodes: [string, number, string?, ('left' | 'right')?][]) => nodes.map(([id, k, parent, side]) => ({ id, keys: [k], ...(parent ? { parent } : {}), ...(side ? { side } : {}) }))

type Case = [TemplateId, string, unknown, RegExp]
const REJECT: Case[] = [
  ['array', 'pointer out of range', { values: [1, 2, 3], pointers: [{ name: 'i', index: 5 }] }, /pointer i = 5 is outside -1..3/],
  ['array', 'range reversed', { values: [1, 2, 3], ranges: [{ id: 'r', from: 2, to: 1 }] }, /starts after it ends/],
  ['array', 'range out of bounds', { values: [1, 2, 3], ranges: [{ id: 'r', from: 0, to: 3 }] }, /outside 0..2/],
  ['array', 'bars need numbers', { values: [1, 'x'], variant: 'bars' }, /bars need numbers/],
  ['array', 'duplicate pointer', { values: [1, 2], pointers: [{ name: 'i', index: 0 }, { name: 'i', index: 1 }] }, /listed twice/],
  ['linked-list', 'head not first', { nodes: [{ id: 'a', value: 1 }, { id: 'b', value: 2 }], head: 'b' }, /head b must be the first node/],
  ['linked-list', 'missing cycle target', { nodes: [{ id: 'a', value: 1 }], cycleTo: 'zz' }, /cycleTo zz does not exist/],
  ['linked-list', 'pointer to missing node', { nodes: [{ id: 'a', value: 1 }], pointers: [{ name: 'p', node: 'q' }] }, /missing node q/],
  ['linked-list', 'duplicate ids', { nodes: [{ id: 'a', value: 1 }, { id: 'a', value: 2 }] }, /used twice/],
  ['stack', 'over capacity', { items: [{ id: 'a', value: 1 }, { id: 'b', value: 2 }], capacity: 1 }, /exceed the capacity/],
  ['queue', 'ring without capacity', { variant: 'ring', items: [] }, /needs a capacity/],
  ['queue', 'ring rear wrong', { variant: 'ring', capacity: 4, front: 3, rear: 3, items: [{ id: 'a', value: 1 }, { id: 'b', value: 2 }] }, /rear must be .* = 1/],
  ['queue', 'front out of range', { variant: 'ring', capacity: 4, front: 4, items: [] }, /front 4 is outside/],
  ['queue', 'front on linear queue', { items: [], front: 1 }, /only for the ring variant/],
  ['hash-table', 'hash out of range', { buckets: 3, strategy: 'chaining', entries: [{ id: 'a', key: 1, hash: 3 }] }, /hash 3 is outside 0..2/],
  ['hash-table', 'chained entry moved', { buckets: 3, strategy: 'chaining', entries: [{ id: 'a', key: 1, hash: 1, slot: 2 }] }, /stays in its hash bucket/],
  ['hash-table', 'two entries in one slot', { buckets: 3, strategy: 'open-addressing', entries: [{ id: 'a', key: 1, hash: 1 }, { id: 'b', key: 4, hash: 1 }] }, /slot 1 holds two entries/],
  ['hash-table', 'linear probe skips a hole', { buckets: 5, strategy: 'open-addressing', probe: 'linear', entries: [{ id: 'a', key: 1, hash: 1 }, { id: 'b', key: 6, hash: 1, slot: 3 }] }, /stop at empty slot 2/],
  ['hash-table', 'duplicate key', { buckets: 3, strategy: 'chaining', entries: [{ id: 'a', key: 1, hash: 1 }, { id: 'b', key: 1, hash: 1 }] }, /key 1 is stored twice/],
  ['tree', 'two roots', { variant: 'nary', nodes: [{ id: 'a', keys: [1] }, { id: 'b', keys: [2] }] }, /exactly one root/],
  ['tree', 'missing parent', { variant: 'nary', nodes: [{ id: 'a', keys: [1] }, { id: 'b', keys: [2], parent: 'x' }] }, /parent x does not exist/],
  ['tree', 'parent cycle', { variant: 'nary', nodes: [{ id: 'r', keys: [0] }, { id: 'a', keys: [1], parent: 'b' }, { id: 'b', keys: [2], parent: 'a' }] }, /parent chain loops/],
  ['tree', 'BST order', { variant: 'bst', nodes: bin([['r', 8], ['l', 3, 'r', 'left'], ['lr', 9, 'l', 'right']]) }, /BST order broken at lr \(key 9\): must be > 3 and < 8/],
  ['tree', 'BST duplicate key', { variant: 'bst', nodes: bin([['r', 8], ['x', 8, 'r', 'right']]) }, /BST order broken at x/],
  ['tree', 'binary child without side', { variant: 'binary', nodes: [{ id: 'r', keys: [1] }, { id: 'c', keys: [2], parent: 'r' }] }, /need a side/],
  ['tree', 'two left children', { variant: 'binary', nodes: bin([['r', 1], ['a', 2, 'r', 'left'], ['b', 3, 'r', 'left']]) }, /two left children/],
  ['tree', 'min-heap order', { variant: 'heap-min', nodes: bin([['r', 5], ['a', 3, 'r', 'left']]) }, /heap order broken: a \(3\) is smaller than its parent r \(5\)/],
  ['tree', 'max-heap order', { variant: 'heap-max', nodes: bin([['r', 5], ['a', 7, 'r', 'left']]) }, /is larger than its parent/],
  ['tree', 'heap not complete', { variant: 'heap-min', nodes: bin([['r', 1], ['b', 3, 'r', 'right']]) }, /heap shape broken: b sits at array index 2/],
  ['tree', 'mixed key types', { variant: 'nary', nodes: [{ id: 'r', keys: [1] }, { id: 'c', keys: ['x'], parent: 'r' }] }, /mix numbers and strings/],
  ['tree', 'B-tree unsorted keys', { variant: 'btree', nodes: [{ id: 'r', keys: [9, 4] }] }, /not in ascending order/],
  ['tree', 'B-tree child count', { variant: 'btree', nodes: [{ id: 'r', keys: [5] }, { id: 'a', keys: [1], parent: 'r' }] }, /1 keys need 2 children, found 1/],
  ['tree', 'B-tree child range', { variant: 'btree', nodes: [{ id: 'r', keys: [5] }, { id: 'a', keys: [1], parent: 'r' }, { id: 'b', keys: [3], parent: 'r' }] }, /key 3 is outside the range/],
  ['tree', 'B-tree uneven leaves', {
    variant: 'btree',
    nodes: [{ id: 'r', keys: [5] }, { id: 'a', keys: [2], parent: 'r' }, { id: 'b', keys: [8], parent: 'r' }, { id: 'a1', keys: [1], parent: 'a' }, { id: 'a2', keys: [3], parent: 'a' }],
  }, /same depth/],
  ['tree', 'trie root with a key', { variant: 'trie', nodes: [{ id: 'r', keys: ['a'] }] }, /root holds no character/],
  ['tree', 'trie duplicate child', { variant: 'trie', nodes: [{ id: 'r', keys: [] }, { id: 'a', keys: ['c'], parent: 'r' }, { id: 'b', keys: ['c'], parent: 'r' }] }, /two children for "c"/],
  ['graph-ds', 'missing endpoint', { directed: false, weighted: false, nodes: [{ id: 'a', label: 'A' }], edges: [{ id: 'e', from: 'a', to: 'b' }] }, /node b does not exist/],
  ['graph-ds', 'weight missing', { directed: false, weighted: true, nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ id: 'e', from: 'a', to: 'b' }] }, /no weight/],
  ['graph-ds', 'weight on unweighted', { directed: false, weighted: false, nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ id: 'e', from: 'a', to: 'b', weight: 2 }] }, /graph is unweighted/],
  ['graph-ds', 'duplicate undirected edge', {
    directed: false,
    weighted: false,
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    edges: [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'b', to: 'a' }],
  }, /duplicates another edge/],
  ['graph-ds', 'self loop', { directed: true, weighted: false, nodes: [{ id: 'a', label: 'A' }], edges: [{ id: 'e', from: 'a', to: 'a' }] }, /self-loop/],
  ['grid', 'ragged rows', { rows: 2, cols: 2, cells: [[1, 2], [3]] }, /row 1 has 1 columns, expected 2/],
  ['grid', 'row count', { rows: 2, cols: 1, cells: [[1]] }, /cells has 1 rows, expected 2/],
  ['grid', 'arrow out of grid', { rows: 1, cols: 2, cells: [[1, 2]], arrows: [{ id: 'a', fromRow: 0, fromCol: 0, toRow: 1, toCol: 1 }] }, /\(1, 1\) is outside the 1×2 grid/],
  ['grid', 'header count', { rows: 1, cols: 2, cells: [[1, 2]], colHeaders: ['a'] }, /colHeaders has 1 entries, expected 2/],
  ['memory', 'pointer to stack frame', { frames: [{ id: 'f', name: 'main()', vars: [{ name: 'x' }] }], heap: [], pointers: [{ id: 'p', from: 'f.x', to: 'f' }] }, /target f is not a heap object/],
  ['memory', 'unknown source variable', { frames: [{ id: 'f', name: 'main()', vars: [] }], heap: [{ id: 'o', label: 'Obj', fields: [] }], pointers: [{ id: 'p', from: 'f.y', to: 'o' }] }, /source f.y is not/],
  ['memory', 'too many objects', {
    frames: Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, name: `f${i}()`, vars: [] })),
    heap: Array.from({ length: 11 }, (_, i) => ({ id: `o${i}`, label: 'Obj', fields: [] })),
    pointers: [],
  }, /exceed the limit of 16/],
  ['memory', 'two pointers from one slot', {
    frames: [{ id: 'f', name: 'main()', vars: [{ name: 'x' }] }],
    heap: [{ id: 'o', label: 'O', fields: [] }],
    pointers: [{ id: 'p1', from: 'f.x', to: 'o' }, { id: 'p2', from: 'f.x', to: 'o' }],
  }, /f.x holds two pointers/],
  ['bits', 'value too wide', { wordSize: 8, fields: [{ id: 'a', label: 'flag', bits: 2, value: 5 }] }, /needs 3 bits but the field has 2/],
  ['bits', 'binary value too wide', { wordSize: 8, fields: [{ id: 'a', label: 'op', bits: 3, value: '0b1010' }] }, /needs 4 bits/],
  ['bits', 'negative value', { wordSize: 8, fields: [{ id: 'a', label: 'n', bits: 4, value: -1 }] }, /not a non-negative integer/],
  ['bits', 'too many bits', { wordSize: 64, fields: Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, label: 'w', bits: 64 })) }, /exceed the limit of 512/],
  ['call-tree', 'memo hit with children', { calls: [{ id: 'a', label: 'f(2)' }, { id: 'b', label: 'f(1)', parent: 'a', memo: true }, { id: 'c', label: 'f(0)', parent: 'b' }] }, /memo hit returns a cached value/],
  ['call-tree', 'two roots', { calls: [{ id: 'a', label: 'f(1)' }, { id: 'b', label: 'f(0)' }] }, /exactly one root/],
  ['pipeline', 'item in unknown stage', { stages: [{ id: 's', label: 'Fetch' }], items: [{ id: 'i', label: 'x', stage: 'q' }] }, /stage q does not exist/],
  ['layers', 'crossing to unknown layer', { layers: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], crossings: [{ id: 'c', from: 'a', to: 'z' }] }, /layer z does not exist/],
  ['layers', 'crossing within a layer', { layers: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], crossings: [{ id: 'c', from: 'a', to: 'a' }] }, /same layer/],
  ['cache', 'over capacity', { policy: 'lru', capacity: 1, entries: [{ id: 'a', key: 'A' }, { id: 'b', key: 'B' }] }, /exceed the capacity of 1/],
  ['cache', 'LFU without counts', { policy: 'lfu', capacity: 2, entries: [{ id: 'a', key: 'A' }] }, /needs a use count/],
  ['cache', 'LFU order', { policy: 'lfu', capacity: 2, entries: [{ id: 'a', key: 'A', freq: 5 }, { id: 'b', key: 'B', freq: 1 }] }, /least used first/],
  ['cache', 'duplicate key', { policy: 'fifo', capacity: 2, entries: [{ id: 'a', key: 'A' }, { id: 'b', key: 'A' }] }, /key A is cached twice/],
  ['comparison', 'unknown option', { options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], criteria: [{ id: 'c', label: 'C' }], cells: [{ option: 'z', criterion: 'c', text: 'x' }] }, /option z does not exist/],
  ['comparison', 'duplicate cell', {
    options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    criteria: [{ id: 'c', label: 'C' }],
    cells: [{ option: 'a', criterion: 'c', text: 'x' }, { option: 'a', criterion: 'c', text: 'y' }],
  }, /cell a\/c is given twice/],
  ['set-ops', 'unknown set', { sets: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], members: [{ id: 'm', label: '1', in: ['c'] }] }, /set c does not exist/],
  ['set-ops', 'crowded region', { sets: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], members: Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, label: `${i}`, in: ['a'] })) }, /6 members in region a; at most 5/],
]

describe('invariants reject', () => {
  it.each(REJECT)('%s: %s', (id, _, props, msg) => {
    const errs = check(id, props)
    expect(errs.join('\n')).toMatch(msg)
  })
})

const ACCEPT: [TemplateId, string, unknown][] = [
  ['tree', 'valid BST', { variant: 'bst', nodes: bin([['r', 8], ['l', 3, 'r', 'left'], ['lr', 6, 'l', 'right'], ['rr', 10, 'r', 'right']]) }],
  ['tree', 'valid max-heap', { variant: 'heap-max', nodes: bin([['r', 9], ['a', 7, 'r', 'left'], ['b', 8, 'r', 'right'], ['c', 1, 'a', 'left']]) }],
  ['tree', 'valid B-tree', {
    variant: 'btree',
    nodes: [{ id: 'r', keys: [10, 20] }, { id: 'a', keys: [2, 5], parent: 'r' }, { id: 'b', keys: [12], parent: 'r' }, { id: 'c', keys: [25, 30], parent: 'r' }],
  }],
  ['tree', 'valid trie', { variant: 'trie', nodes: [{ id: 'r', keys: [] }, { id: 'c', keys: ['c'], parent: 'r' }, { id: 'ca', keys: ['a'], parent: 'c' }, { id: 'cat', keys: ['t'], parent: 'ca', terminal: true }] }],
  ['hash-table', 'linear probing', { buckets: 5, strategy: 'open-addressing', probe: 'linear', entries: [{ id: 'a', key: 1, hash: 4 }, { id: 'b', key: 6, hash: 4, slot: 0 }, { id: 'c', key: 11, hash: 4, slot: 1 }] }],
  ['queue', 'ring wrap', { variant: 'ring', capacity: 4, front: 3, rear: 1, items: [{ id: 'a', value: 1 }, { id: 'b', value: 2 }] }],
  ['array', 'pointer one past the end', { values: [1, 2], pointers: [{ name: 'hi', index: 2 }] }],
  ['bits', 'text and hex values', { wordSize: 16, fields: [{ id: 'v', label: 'version', bits: 4, value: 'IPv4' }, { id: 'h', label: 'len', bits: 4, value: '0xF' }] }],
]

describe('invariants accept', () => {
  it.each(ACCEPT)('%s: %s', (id, _, props) => {
    expect(check(id, props)).toEqual([])
  })
})

describe('dropElement', () => {
  it('drops list elements and what depended on them', () => {
    const ll = t('linked-list').dropElement!(t('linked-list').example, 'nodes.0') as Record<string, unknown>
    expect(ll.head).toBe('n2')
    expect(t('linked-list').checkInvariants!(ll)).toEqual([])
    const g = t('graph-ds').dropElement!(t('graph-ds').example, 'nodes.2') as { edges: { from: string; to: string }[] }
    expect(g.edges.some((e) => e.from === 'C' || e.to === 'C')).toBe(false)
    const tree = t('tree').dropElement!(t('tree').example, 'nodes.1') as { nodes: unknown[] }
    expect(tree.nodes).toHaveLength(3)
    const mem = t('memory').dropElement!(t('memory').example, 'heap.0') as { pointers: { to: string }[] }
    expect(mem.pointers.map((p) => p.to)).not.toContain('L')
    const grid = t('grid').dropElement!(t('grid').example, 'cells.3.3') as { cells: unknown[][] }
    expect(grid.cells[3]![3]).toBeNull()
  })

  it('does not mutate its input', () => {
    const before = ex('comparison')
    const frozen = structuredClone(before)
    t('comparison').dropElement!(before, 'criteria.0')
    expect(before).toEqual(frozen)
  })

  it('refuses drops that would shift other elements', () => {
    expect(() => t('array').dropElement!(t('array').example, 'values.2')).toThrow(TemplateDropError)
    expect(() => t('bits').dropElement!(t('bits').example, 'fields.0')).toThrow(TemplateDropError)
    expect(() => t('tree').dropElement!(t('tree').example, 'nodes.0')).toThrow(/cannot be dropped/)
  })

  it('every template drops its example evidence paths or refuses explicitly', () => {
    for (const id of ['array', 'linked-list', 'stack', 'queue', 'hash-table', 'tree', 'graph-ds', 'grid', 'memory', 'bits', 'call-tree', 'pipeline', 'layers', 'cache', 'comparison', 'set-ops'] as TemplateId[]) {
      for (const e of t(id).exampleEvidence) {
        try {
          const out = t(id).dropElement!(t(id).example, e.path)
          t(id).propsSchema.parse(out)
        } catch (err) {
          expect(err, `${id} ${e.path}`).toBeInstanceOf(TemplateDropError)
        }
      }
    }
  })
})
