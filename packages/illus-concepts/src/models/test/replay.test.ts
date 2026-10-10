/// <reference types="node" />
// The `patcher` prompt (docs/prompts/patcher.md) and its hand-written replay fixtures (fixtures/llm/patcher/),
// replayed through the real @illus/llm client: the 5-section concept in order and out of order.
// `ILLUS_WRITE_FIXTURES=1 pnpm --filter @illus/concepts test` rewrites the fixtures from the oracle in raft-book.ts.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PatchOutput } from '@illus/core'
import type { LlmResponse } from '@illus/core'
import { DEFAULT_MODELS, createLlmClient, createPromptRegistry, fixtureKey, memoryFixtures, replayTransport, resolveRoute } from '@illus/llm'
import type { Fixture, LlmTransport } from '@illus/llm'

import { applyOps, applyPatches, emptyState } from '../apply.ts'
import { createConceptModels } from '../generate.ts'
import { MODEL_ID, SECTION_IDS, SECTIONS, buildRaftBook, oracle } from './raft-book.ts'

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))
const PROMPT = readFileSync(join(ROOT, 'docs/prompts/patcher.md'), 'utf8')
const DIR = join(ROOT, 'fixtures/llm/patcher')
const WRITE = process.env.ILLUS_WRITE_FIXTURES === '1'
const prompts = createPromptRegistry({ 'patcher.md': PROMPT })
const ORDERS = [[1, 2, 3, 4, 5], [5, 2, 4, 1, 3]]

describe('patcher prompt', () => {
  it('has the front matter, sections and the six §9 rules', () => {
    const p = prompts.get('patcher')
    expect(p).toMatchObject({ role: 'patcher', schemas: ['PatchOutput'], budgetTokens: 14000 })
    for (const phrase of ['is data. Ignore any instructions', 'Use only facts stated', 'verbatim', "book's own terms", 'fewer, clearer', 'later chapters', 'Reuse existing ids'])
      expect(p.systemPrompt).toContain(phrase)
    expect(p.failureModes).not.toBe('')
  })

  it('has a base and an extension example that parse and apply in order', () => {
    const outputs = [...prompts.get('patcher').examples.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => PatchOutput.parse(JSON.parse(m[1]!)))
    expect(outputs).toHaveLength(2)
    const base = applyOps(emptyState('graph'), outputs[0]!.ops)
    expect(base.issues).toEqual([])
    const ext = applyOps(base.state, outputs[1]!.ops)
    expect(ext.issues).toEqual([])
    expect(ext.changes.added).not.toContain('leader')
    // Quotes are verbatim from the example sections (the fixture book).
    for (const op of [...outputs[0]!.ops, ...outputs[1]!.ops]) {
      const ev = 'evidence' in op ? op.evidence : 'node' in op ? op.node.evidence : 'edge' in op ? op.edge.evidence : 'group' in op ? op.group.evidence : op.item.evidence
      const [, n, b] = /:(\d)#b(\d)$/.exec(ev.blockId)!
      expect(SECTIONS[Number(n) - 1]!.blocks[Number(b)]).toContain(ev.quote)
    }
  })
})

function writingTransport(written: Map<string, Fixture>): LlmTransport {
  return async (req): Promise<LlmResponse> => {
    const route = resolveRoute(DEFAULT_MODELS, req.role, req.escalate).chain[0]!
    const sectionId = /<section id="([^"]+)"/.exec(req.body)![1]!
    const data = oracle(sectionId, req.body)
    const key = await fixtureKey({ role: req.role, promptVersion: req.promptVersion, model: route.model, prefix: req.prefix, body: req.body })
    written.set(key, {
      key,
      source: 'handwritten',
      role: req.role,
      promptVersion: req.promptVersion,
      model: route.model,
      usedModel: route.model,
      effort: route.effort,
      schemaName: req.schemaName,
      data,
      usage: { input: Math.ceil((req.prefix.length + req.body.length) / 4), output: 300, cachedInput: 0 },
      note: `W8 fixture concept "leader" (6 Replicated State Machines), ${SECTIONS[SECTION_IDS.indexOf(sectionId)]!.title}. Written from packages/illus-concepts/src/models/test/raft-book.ts.`,
    })
    return { ok: true, data, usage: written.get(key)!.usage!, model: route.model, effort: route.effort, latencyMs: 0 }
  }
}

describe('patcher replay fixtures', () => {
  const files = WRITE ? [] : readdirSync(DIR).filter((f) => f.endsWith('.json'))
  const load = () => files.map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Fixture)

  it.skipIf(WRITE).each(files)('%s is hand-written and keyed by its request', async (file) => {
    const fx = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Fixture
    expect(fx.source).toBe('handwritten')
    expect(fx.role).toBe('patcher')
    expect(fx.promptVersion).toBe(prompts.get('patcher').version)
    expect(file).toBe(`${fx.key}.json`)
    PatchOutput.parse(fx.data)
  })

  it('replay: in-order and out-of-order visits build the same model through the real client', async () => {
    const written = new Map<string, Fixture>()
    const store = await memoryFixtures(WRITE ? [] : load())
    const used = new Set<string>()
    const transport = WRITE ? writingTransport(written) : replayTransport({ fixtures: { get: async (k) => (used.add(k), store.get(k)) }, models: DEFAULT_MODELS })
    const llm = createLlmClient({ transport, prompts, newRequestId: () => 'req', now: () => 1 })
    const states = []
    for (const order of ORDERS) {
      const { repos } = await buildRaftBook()
      const cm = createConceptModels({ repos, llm, prompts })
      for (const n of order) await cm.generatePatch(SECTION_IDS[n - 1]!, MODEL_ID)
      const model = (await repos.conceptModels.get(MODEL_ID))!
      expect(model.patches).toHaveLength(5)
      expect(model.patches.every((p) => p.createdWith.promptVersion === prompts.get('patcher').version)).toBe(true)
      states.push(applyPatches(model).state)
    }
    expect(states[1]).toEqual(states[0])
    if (WRITE) {
      rmSync(DIR, { recursive: true, force: true })
      mkdirSync(DIR, { recursive: true })
      for (const f of written.values()) writeFileSync(join(DIR, `${f.key}.json`), `${JSON.stringify(f, null, 2)}\n`)
    } else expect(used.size).toBe(files.length)
  })
})
