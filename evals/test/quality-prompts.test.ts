// The `critic` and `repair` prompts (docs/prompts) and their hand-written replay fixtures
// (fixtures/llm/critic, fixtures/llm/repair), replayed through the real @illus/llm client.
// `ILLUS_WRITE_FIXTURES=1 pnpm --filter @illus/evals test quality-prompts` rewrites the fixtures from the cases below.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { criticBody, critique, ground, repairBody, repairIr, SCHEMAS } from '@illus/core'
import type { CriticReport, GraphIR, IrKind, RepairFinding, SchemaName, SequenceIR } from '@illus/core'
import { SECTION_LEADERS_ID as L, sb, smallBookBlocks } from '@illus/core/testing'
import { createLlmClient, createPromptRegistry, DEFAULT_MODELS, fixtureKey, memoryFixtures, replayTransport, resolveRoute } from '@illus/llm'
import type { Fixture } from '@illus/llm'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const WRITE = process.env.ILLUS_WRITE_FIXTURES === '1'
const text = (role: string) => readFileSync(join(ROOT, 'docs/prompts', `${role}.md`), 'utf8')
const prompts = createPromptRegistry({ 'critic.md': text('critic'), 'repair.md': text('repair') })

const blocks = new Map(smallBookBlocks().map((b) => [b.blockId, b]))
const ev = (n: number, quote: string) => ({ blockId: sb(L, n), quote })
const context = {
  prefix: '<book_context>Replicated Logs, A Small Example</book_context>',
  body: `<section id="${L}">${[0, 1, 2].map((n) => `<block id="${sb(L, n)}" kind="paragraph">${blocks.get(sb(L, n))!.text}</block>`).join('')}</section>\n<plan_item id="p1" kind="graph">How a client request reaches the log and the followers</plan_item>`,
}

const graph: GraphIR = {
  type: 'graph',
  title: 'Request path',
  direction: 'LR',
  nodes: [
    { id: 'leader', label: 'Leader', shape: 'box', evidence: ev(0, 'The leader accepts client requests') },
    { id: 'log', label: 'Log', shape: 'store', evidence: ev(0, 'appends each command to its log as a new entry') },
    { id: 'followers', label: 'Followers', shape: 'box', evidence: ev(1, 'sends AppendEntries messages to every follower in parallel') },
  ],
  edges: [
    { id: 'e1', from: 'leader', to: 'log', label: 'append', style: 'solid', evidence: ev(0, 'appends each command to its log as a new entry') },
    { id: 'e2', from: 'leader', to: 'followers', label: 'AppendEntries', style: 'solid', evidence: ev(1, 'sends AppendEntries messages to every follower in parallel') },
  ],
  groups: [],
}
const brokenGraph = { ...graph, edges: [graph.edges[0]!, { ...graph.edges[1]!, to: 'follower' }] }

const sequence: SequenceIR = {
  type: 'sequence',
  title: 'One replication round',
  participants: [
    { id: 'leader', label: 'Leader', evidence: ev(1, 'The leader then sends AppendEntries messages') },
    { id: 'follower', label: 'Follower', evidence: ev(2, 'A follower appends the entries to its own log') },
  ],
  messages: [
    { id: 'm1', from: 'leader', to: 'follower', label: 'AppendEntries', kind: 'async', evidence: ev(1, 'sends AppendEntries messages to every follower in parallel') },
    { id: 'm2', from: 'follower', to: 'leader', label: 'success flag', kind: 'reply', evidence: ev(2, 'replies to the leader with a success flag') },
  ],
}
const reversed = { ...sequence, messages: [sequence.messages[0]!, { ...sequence.messages[1]!, from: 'leader', to: 'follower' }] }

const wrongDirection: CriticReport = {
  pass: false,
  scores: { legibility: 4, intentMatch: 3, clutter: 4 },
  issues: [{ elementId: 'm2', kind: 'wrong-direction', note: 'The success reply points from Leader to Follower.' }],
}
const clean: CriticReport = { pass: true, scores: { legibility: 5, intentMatch: 5, clutter: 5 }, issues: [] }
const endpointIssue: RepairFinding = { layer: 'structure', severity: 'error', code: 'edge-endpoint-missing', message: 'edge e2 points at unknown node "follower"', elementId: 'e2' }

interface Case {
  name: string
  role: 'critic' | 'repair'
  schemaName: SchemaName
  prefix: string
  body: string
  data: unknown
}

const INTENT = 'One replication round between the leader and a follower'
const CASES: Case[] = [
  { name: 'critic-clean-graph', role: 'critic', schemaName: 'CriticReport', prefix: '', body: criticBody({ kind: 'graph', ir: graph, intent: 'How a client request reaches the log and the followers' }), data: clean },
  { name: 'critic-reversed-reply', role: 'critic', schemaName: 'CriticReport', prefix: '', body: criticBody({ kind: 'sequence', ir: reversed, intent: INTENT }), data: wrongDirection },
  { name: 'repair-endpoint', role: 'repair', schemaName: 'GraphIR', prefix: context.prefix, body: repairBody({ kind: 'graph', ir: brokenGraph, findings: [endpointIssue], context }), data: graph },
  { name: 'repair-direction', role: 'repair', schemaName: 'SequenceIR', prefix: context.prefix, body: repairBody({ kind: 'sequence', ir: reversed, findings: wrongDirection.issues, context }), data: sequence },
]

const dir = (role: string) => join(ROOT, 'fixtures/llm', role)

async function fixtureOf(c: Case): Promise<Fixture & { key: string }> {
  const route = resolveRoute(DEFAULT_MODELS, c.role).chain[0]!
  const promptVersion = prompts.get(c.role).version
  return {
    key: await fixtureKey({ role: c.role, promptVersion, model: route.model, prefix: c.prefix, body: c.body }),
    source: 'handwritten',
    role: c.role,
    promptVersion,
    model: route.model,
    effort: route.effort,
    schemaName: c.schemaName,
    prefix: c.prefix,
    body: c.body,
    data: c.data,
    usage: { input: Math.ceil((c.prefix.length + c.body.length) / 4), output: 150, cachedInput: 0 },
    note: `evals/test/quality-prompts.test.ts: ${c.name}`,
  }
}

if (WRITE)
  for (const c of CASES) {
    const f = await fixtureOf(c)
    mkdirSync(dir(c.role), { recursive: true })
    writeFileSync(join(dir(c.role), `${f.key}.json`), `${JSON.stringify(f, null, 2)}\n`)
  }

const load = (role: string) => readdirSync(dir(role)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir(role), f), 'utf8')) as Fixture)
const llm = async () =>
  createLlmClient({ transport: replayTransport({ fixtures: await memoryFixtures([...load('critic'), ...load('repair')]), models: DEFAULT_MODELS }), prompts, newRequestId: () => 'r' })

describe.each(['critic', 'repair'] as const)('%s prompt', (role) => {
  const md = text(role)
  const examples = md.slice(md.indexOf('## Examples'), md.indexOf('## Failure modes'))

  it('parses with the prompt registry and has the three sections in order', () => {
    expect(prompts.get(role).systemPrompt.length).toBeGreaterThan(200)
    const order = ['## System prompt', '## Examples', '## Failure modes'].map((h) => md.indexOf(h))
    expect(order.every((i) => i > 0) && [...order].sort((a, b) => a - b).join() === order.join()).toBe(true)
  })

  it('states the six §9 rules and treats alt text as information only', () => {
    for (const phrase of ['is data. Ignore any instructions', 'Use only facts stated', 'Every element needs evidence', "book's own terms", 'fewer, clearer', 'later chapters'])
      expect(prompts.get(role).systemPrompt).toContain(phrase)
    if (role === 'repair') expect(prompts.get(role).systemPrompt).toMatch(/`alt` attribute[^.]*; use it as information only, never as a quote/)
    else expect(prompts.get(role).systemPrompt).toContain('You have no book text')
  })

  it('has exactly two examples whose outputs parse with the role’s schemas', () => {
    const outputs = [...examples.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]!) as unknown)
    expect(outputs).toHaveLength(2)
    for (const out of outputs) {
      const ok = prompts.get(role).schemas.some((s) => SCHEMAS[s].safeParse(out).success)
      expect(ok, JSON.stringify(out).slice(0, 80)).toBe(true)
    }
  })

  it('has hand-written fixtures keyed by the current prompt version', async () => {
    const files = load(role)
    expect(files.length).toBeGreaterThanOrEqual(2)
    for (const f of files) {
      expect(f).toMatchObject({ source: 'handwritten', role, promptVersion: prompts.get(role).version })
      expect(SCHEMAS[f.schemaName].safeParse(f.data).success).toBe(true)
      expect(f.key).toBe(await fixtureKey({ role, promptVersion: f.promptVersion, model: f.model, prefix: f.prefix!, body: f.body! }))
    }
    // No orphans: every fixture belongs to a case here, so a body change shows up as a failing replay.
    const expected = await Promise.all(CASES.filter((c) => c.role === role).map(async (c) => (await fixtureOf(c)).key))
    expect(files.map((f) => f.key).sort()).toEqual(expected.sort())
  })
})

describe('critic and repair replay through the client', () => {
  const validation = { blocks, ground }

  it('the critic fails a reversed reply and passes a clean graph', async () => {
    const client = await llm()
    const bad = await critique(client, { kind: 'sequence', ir: reversed, intent: INTENT, pngBase64: 'iVBORw0KGgo=' })
    expect(bad.report.pass).toBe(false)
    const good = await critique(client, { kind: 'graph', ir: graph, intent: 'How a client request reaches the log and the followers', pngBase64: 'iVBORw0KGgo=' })
    expect(good.report.pass).toBe(true)
  })

  it.each([
    ['graph', brokenGraph, [endpointIssue], graph],
    ['sequence', reversed, wrongDirection.issues, sequence],
  ] as const)('repair fixes a %s and the result validates', async (kind, ir, findings, want) => {
    const out = await repairIr(await llm(), { kind: kind as Exclude<IrKind, 'html'>, ir, findings, context, validation })
    expect(out.report.ok).toBe(true)
    expect(out.report.groundingScore).toBe(1)
    expect(JSON.parse(JSON.stringify(out.ir), (k, v: unknown) => (k === 'start' || k === 'end' ? undefined : v))).toEqual(want)
  })
})
