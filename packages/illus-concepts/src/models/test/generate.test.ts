// §13 patch generation on the 5-section fixture concept with the hand-written oracle patcher (no model calls).
import { describe, expect, it } from 'vitest'

import { PatchOutput, makeConceptModelId } from '@illus/core'
import type { ConceptModel, LlmCall, PatchOp } from '@illus/core'
import { make } from '@illus/core/testing'

import { applyPatches } from '../apply.ts'
import { createConceptModels, insertPatch, revalidateAfter } from '../generate.ts'
import { sectionView } from '../view.ts'
import { CONCEPT_ID, DESCRIBED, MODEL_ID, SECTION_IDS, buildRaftBook, oracle } from './raft-book.ts'

interface Call {
  sectionId: string
  body: string
}

function oracleLlm(calls: Call[], answer: (sectionId: string, body: string) => unknown = oracle): LlmCall {
  return {
    call: (async (_role: string, ctx: { prefix: string; body: string }, opts: { sectionId?: string } = {}) => {
      calls.push({ sectionId: opts.sectionId!, body: ctx.body })
      return {
        data: PatchOutput.parse(answer(opts.sectionId!, ctx.body)),
        model: 'gpt-test',
        effort: 'medium',
        promptVersion: '1.0.0',
        usage: { input: 100, output: 20, cachedInput: 0 },
        latencyMs: 0,
        requestId: 'r',
      }
    }) as LlmCall['call'],
  }
}

async function visit(order: number[]) {
  const { repos } = await buildRaftBook()
  const calls: Call[] = []
  const catchUps: number[] = []
  const cm = createConceptModels({ repos, llm: oracleLlm(calls), onCatchUp: (e) => catchUps.push(e.count) })
  const results = []
  for (const n of order) results.push(await cm.generatePatch(SECTION_IDS[n - 1]!, MODEL_ID))
  return { repos, cm, calls, catchUps, results, model: (await repos.conceptModels.get(MODEL_ID))! }
}

const ids = (m: ConceptModel, upto?: number) => applyPatches(m, upto).state.elements.map((e) => e.item.id)

describe('generatePatch on the 5-section fixture concept', () => {
  it('grows in order, one patch per section, with each section’s additions highlighted', async () => {
    const { model, calls, catchUps } = await visit([1, 2, 3, 4, 5])
    expect(calls.map((c) => SECTION_IDS.indexOf(c.sectionId) + 1)).toEqual([1, 2, 3, 4, 5])
    expect(catchUps).toEqual([])
    expect(model.patches.map((p) => [p.sectionOrdinal, !!p.rebased, !!p.stale])).toEqual([1, 2, 3, 4, 5].map((n) => [n, false, false]))
    // The patcher always sees the state before its section in slot 7.
    expect(calls[0]!.body).toContain('<concept_model id="')
    expect(calls[1]!.body).toContain('"id":"leader"')

    const newBy = [1, 2, 3, 4, 5].map((n) => sectionView(model, n).newIds)
    expect(newBy).toEqual([
      ['cluster', 'leader', 'follower', 'client', 'e-request', 'e-respond'],
      ['leader-log', 'e-append', 'e-appendentries', 'follower-log', 'e-write'],
      ['candidate', 'e-timeout', 'e-requestvote', 'e-wins'],
      ['commit-index', 'e-tracks', 'state-machine', 'e-apply'],
      ['snapshot', 'e-compact', 'e-install'],
    ])
    // The model only grows: every earlier element is still there at the next section.
    for (let n = 2; n <= 5; n++) expect(ids(model, n)).toEqual(expect.arrayContaining(ids(model, n - 1)))
    expect(sectionView(model, 4).frame.annotations).toEqual({ 'node:commit-index': 'highest entry on a majority' })
    // Evidence was grounded (offsets filled in).
    expect(applyPatches(model).state.elements.every((e) => e.item.evidence.start !== undefined)).toBe(true)
  })

  it('out-of-order visits converge to the in-order state (rebase, catch-up, insertion, re-validation)', async () => {
    const inOrder = await visit([1, 2, 3, 4, 5])
    const out = await visit([5, 2, 4, 1, 3])
    // 5 first: four gaps → one rebased patch. 2: catch up 1. 4: catch up 3. 1 and 3: reused.
    expect(out.calls.map((c) => SECTION_IDS.indexOf(c.sectionId) + 1)).toEqual([5, 1, 2, 3, 4])
    expect(out.catchUps).toEqual([1, 1])
    expect(out.calls[0]!.body).toContain('<gap_summaries>')
    expect(out.model.patches.find((p) => p.sectionOrdinal === 5)!.rebased).toBe(true)
    expect(out.model.patches.some((p) => p.stale)).toBe(false)
    expect(applyPatches(out.model).state).toEqual(applyPatches(inOrder.model).state)
    for (let n = 1; n <= 5; n++) expect(sectionView(out.model, n).ir).toEqual(sectionView(inOrder.model, n).ir)
  })

  it('every order of visits converges', async () => {
    const target = applyPatches((await visit([1, 2, 3, 4, 5])).model).state
    for (const order of [[3, 1, 2, 5, 4], [4, 5, 1, 2, 3], [2, 4, 3, 5, 1]]) expect(applyPatches((await visit(order)).model).state).toEqual(target)
  })

  it('catches up at most three gap sections, in order, before S', async () => {
    const { calls, catchUps, results } = await visit([4])
    expect(calls.map((c) => SECTION_IDS.indexOf(c.sectionId) + 1)).toEqual([1, 2, 3, 4])
    expect(catchUps).toEqual([3])
    expect(results[0]!.caughtUp).toEqual(SECTION_IDS.slice(0, 3))
    expect(results[0]!.patch.rebased).toBeUndefined()
  })

  it('reuses a stored patch instead of calling the patcher again', async () => {
    const { cm, calls } = await visit([1])
    const again = await cm.generatePatch(SECTION_IDS[0]!, MODEL_ID)
    expect(calls).toHaveLength(1)
    expect(again.usageTokens).toBe(0)
  })

  it('drops ungrounded or unresolved ops, retries once with the validator report', async () => {
    const { repos } = await buildRaftBook()
    const calls: Call[] = []
    const bad: PatchOp[] = [
      { op: 'addNode', node: { id: 'leader', label: 'Leader', shape: 'box', evidence: { blockId: `${SECTION_IDS[0]}#b0`, quote: 'a sentence the book never says' } } },
      { op: 'addEdge', edge: { id: 'e', from: 'leader', to: 'ghost', style: 'solid', evidence: { blockId: `${SECTION_IDS[0]}#b2`, quote: 'Clients send every request' } } },
    ]
    const cm = createConceptModels({ repos, llm: oracleLlm(calls, (s, body) => (calls.length === 1 ? { ops: bad } : oracle(s, body))) })
    const r = await cm.generatePatch(SECTION_IDS[0]!, MODEL_ID)
    expect(calls).toHaveLength(2)
    expect(calls[1]!.body).toContain('<validator_report dropped="2" total="2">')
    expect(calls[1]!.body).toContain('code="quote-not-found"')
    expect(calls[1]!.body).toContain('code="unresolved-ref"')
    expect(r.report).toMatchObject({ ok: true, retried: true })
    expect(r.patch.ops).toHaveLength(DESCRIBED[0]!.length)
  })

  it('a patch that still fails is stored stale and the item fails', async () => {
    const { repos } = await buildRaftBook()
    const calls: Call[] = []
    const cm = createConceptModels({
      repos,
      llm: oracleLlm(calls, () => ({ ops: [{ op: 'update', id: 'nothing', label: 'x', evidence: { blockId: `${SECTION_IDS[0]}#b0`, quote: 'A cluster runs several servers' } }] })),
    })
    await expect(cm.generatePatch(SECTION_IDS[0]!, MODEL_ID)).rejects.toThrow('failed validation')
    expect((await repos.conceptModels.get(MODEL_ID))!.patches[0]).toMatchObject({ stale: true, ops: [] })
  })

  it('route: patches the model and returns S’s view IR', async () => {
    const { repos } = await buildRaftBook()
    const calls: Call[] = []
    const cm = createConceptModels({ repos, llm: { call: () => Promise.reject(new Error('use the route llm')) } })
    const section = (await repos.sections.get(SECTION_IDS[1]!))!
    const out = await cm.route({
      planItem: make.planItem({ conceptIds: [CONCEPT_ID], newConceptModel: CONCEPT_ID }),
      section,
      context: { prefix: '', body: '', usedBlockIds: [], dropped: [], tokens: 0 },
      llm: oracleLlm(calls),
    })
    expect(calls).toHaveLength(2) // catch-up of 6.1, then 6.2
    expect(out.kind).toBe('graph')
    expect(out.ir).toMatchObject({ type: 'graph', title: 'leader' })
    expect(out.ir.type === 'graph' && out.ir.nodes.map((n) => n.id)).toEqual(['leader', 'follower', 'client', 'leader-log', 'follower-log'])
    expect(out.promptVersions).toEqual({ patcher: '1.0.0' })
    expect(out.models).toEqual({ patcher: 'gpt-test@medium' })
    expect(out.usageTokens).toBe(240)
    expect(makeConceptModelId(CONCEPT_ID, 'graph')).toBe(MODEL_ID)
  })
})

describe('re-validation of later patches (§13 step 5)', () => {
  const ev = { blockId: 'b', quote: 'three words here' }
  const n = (id: string, label = id): PatchOp => ({ op: 'addNode', node: { id, label, shape: 'box', evidence: ev } })
  const p = (ord: number, ops: PatchOp[]) => make.patch({ patchId: `m@${ord}`, sectionId: `s${ord}`, sectionOrdinal: ord, ops })

  it('turns an add of an existing id into an update of what differs, or drops it', () => {
    let m = make.conceptModel({ patches: [p(5, [n('a'), n('b', 'Bee'), { op: 'addEdge', edge: { id: 'e', from: 'a', to: 'b', style: 'solid', evidence: ev } }])] })
    m = revalidateAfter(insertPatch(m, p(2, [n('a'), n('b')])), 2)
    expect(m.patches.map((x) => x.sectionOrdinal)).toEqual([2, 5])
    expect(m.patches[1]!.ops.map((o) => o.op)).toEqual(['update', 'addEdge'])
    expect(m.patches[1]!.ops[0]).toMatchObject({ op: 'update', id: 'b', label: 'Bee' })
    expect(m.patches[1]!.stale).toBeUndefined()
  })

  it('marks a later patch stale when it still fails, and skips it until regenerated', () => {
    let m = make.conceptModel({ patches: [p(5, [n('x'), { op: 'addEdge', edge: { id: 'e', from: 'x', to: 'x', style: 'solid', evidence: ev } }])] })
    // The inserted earlier patch uses id `e` for a node: the later edge `e` cannot become an update.
    m = revalidateAfter(insertPatch(m, p(2, [n('e')])), 2)
    expect(m.patches[1]!.stale).toBe(true)
    expect(applyPatches(m).state.elements.map((x) => x.item.id)).toEqual(['e'])
  })

  it('a stale patch is regenerated on its next visit', async () => {
    const { repos } = await buildRaftBook()
    const calls: Call[] = []
    const cm = createConceptModels({ repos, llm: oracleLlm(calls) })
    await cm.generatePatch(SECTION_IDS[0]!, MODEL_ID)
    const stored = (await repos.conceptModels.get(MODEL_ID))!
    await repos.conceptModels.put({ ...stored, patches: stored.patches.map((x) => ({ ...x, stale: true })) })
    const r = await cm.generatePatch(SECTION_IDS[0]!, MODEL_ID)
    expect(calls).toHaveLength(2)
    expect(r.patch.stale).toBeUndefined()
  })
})

