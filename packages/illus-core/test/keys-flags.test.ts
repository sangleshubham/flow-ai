import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FLAGS,
  parseFlagList,
  planKey,
  resolveFlags,
  sha256Hex,
  traceKey,
  VisualPlan,
  visualKey,
} from '../src/index.ts'
import type { RoleRun } from '../src/index.ts'
import { make } from '../src/testing/index.ts'

const planner: RoleRun = {
  promptVersion: '1.0.0',
  model: 'gpt-6.1-sol',
  effort: 'medium',
}
const planInput = {
  bookId: 'b',
  sectionId: 's',
  contentHash: 'h',
  contextVersion: 1,
  planner,
}

describe('cache keys (§5)', () => {
  it('plan key is sha256 of the JSON array of its parts, in spec order', async () => {
    expect(await planKey(planInput)).toBe(
      await sha256Hex(
        JSON.stringify(['b', 's', 'h', 1, '1.0.0', 'gpt-6.1-sol', 'medium']),
      ),
    )
  })

  it('plan key with no kinds equals the legacy key; kinds is part of the hash', async () => {
    const base = await planKey(planInput)
    expect(await planKey({ ...planInput, kinds: undefined })).toBe(base)
    const withKinds = await planKey({
      ...planInput,
      kinds: 'animations,templates',
    })
    expect(withKinds).not.toBe(base)
    expect(await planKey({ ...planInput, kinds: 'templates' })).not.toBe(
      withKinds,
    )
  })

  it('changes with model and effort, so a fallback never overwrites a primary result', async () => {
    const base = await planKey(planInput)
    expect(
      await planKey({
        ...planInput,
        planner: { ...planner, model: 'gpt-6-sol' },
      }),
    ).not.toBe(base)
    expect(
      await planKey({ ...planInput, planner: { ...planner, effort: 'high' } }),
    ).not.toBe(base)
  })

  it('visual key hashes a missing templateId as null and appends an instruction only when present', async () => {
    const input = {
      planKey: 'pk',
      planItem: { kind: 'graph' as const, intent: 'show it' },
      extractor: planner,
      compilerVersion: 3,
    }
    const parts = [
      'pk',
      'graph',
      null,
      'show it',
      '1.0.0',
      'gpt-6.1-sol',
      'medium',
      3,
    ]
    expect(await visualKey(input)).toBe(await sha256Hex(JSON.stringify(parts)))
    expect(await visualKey({ ...input, instruction: '' })).toBe(
      await visualKey(input),
    )
    expect(await visualKey({ ...input, instruction: 'bigger' })).toBe(
      await sha256Hex(JSON.stringify([...parts, 'bigger'])),
    )
  })

  it('trace key covers source, translator run and tracer version', async () => {
    const t = {
      codeSource: 'x = 1',
      translator: { ...planner, effort: 'high' as const },
      tracerVersion: '2',
    }
    expect(await traceKey(t)).toBe(
      await sha256Hex(
        JSON.stringify(['x = 1', '1.0.0', 'gpt-6.1-sol', 'high', '2']),
      ),
    )
    expect(await traceKey({ ...t, tracerVersion: '3' })).not.toBe(
      await traceKey(t),
    )
  })
})

describe('flags (§4)', () => {
  it('defaults templates and animations on, the rest off', () => {
    expect(DEFAULT_FLAGS).toEqual({
      templates: true,
      animations: true,
      tracer: false,
      conceptModels: false,
      critic: false,
      htmlFallback: false,
    })
    expect(Object.keys(DEFAULT_FLAGS).sort()).toEqual([
      'animations',
      'conceptModels',
      'critic',
      'htmlFallback',
      'templates',
      'tracer',
    ])
  })

  it('merges valid overrides and ignores junk', () => {
    expect(resolveFlags({ critic: true, bogus: true })).toEqual({
      ...DEFAULT_FLAGS,
      critic: true,
    })
    expect(resolveFlags({ critic: 'yes' })).toEqual(DEFAULT_FLAGS)
    expect(resolveFlags(null)).toEqual(DEFAULT_FLAGS)
  })

  it('parses comma lists with negation', () => {
    expect(parseFlagList('templates, -critic,nope')).toEqual({
      templates: true,
      critic: false,
    })
    expect(parseFlagList(undefined)).toEqual({})
  })
})

describe('plan overview and caption', () => {
  it('are optional and word-limited', () => {
    const plan = make.visualPlan()
    expect(VisualPlan.safeParse(plan).success).toBe(true)
    expect(
      VisualPlan.safeParse({ ...plan, overview: 'Big idea.' }).success,
    ).toBe(true)
    expect(
      VisualPlan.safeParse({ ...plan, overview: 'w '.repeat(121) }).success,
    ).toBe(false)
    expect(
      VisualPlan.safeParse({
        ...plan,
        items: [{ ...plan.items[0], caption: 'w '.repeat(61) }],
      }).success,
    ).toBe(false)
  })
})
