import { describe, expect, it } from 'vitest'

import { RoleName } from '@illus/core'

import { DEFAULT_MODELS, loadModelsConfig, resolveRoute } from '../src/index.ts'

describe('loadModelsConfig', () => {
  it('uses the §9 default when unset', () => {
    expect(loadModelsConfig(undefined)).toEqual(DEFAULT_MODELS)
    expect(loadModelsConfig('  ')).toEqual(DEFAULT_MODELS)
  })

  it.each(['xhigh', 'max', 'ultra', 'none'])('rejects effort %s', (effort) => {
    expect(() =>
      loadModelsConfig(JSON.stringify({ efforts: { planner: effort } })),
    ).toThrow(/not allowed in v1/)
    expect(() =>
      loadModelsConfig(
        JSON.stringify({
          tiers: {
            ...DEFAULT_MODELS.tiers,
            deep: [{ model: 'gpt-6-astra', effort }],
          },
        }),
      ),
    ).toThrow(/not allowed in v1/)
  })

  it('rejects models that are not on the allowlist', () => {
    const json = JSON.stringify({
      tiers: { ...DEFAULT_MODELS.tiers, fast: [{ model: 'gpt-4o' }] },
    })
    expect(() => loadModelsConfig(json)).toThrow(
      /gpt-4o is not on the allowlist/,
    )
  })

  it('rejects efforts outside allowedEfforts and unknown keys', () => {
    expect(() =>
      loadModelsConfig(
        JSON.stringify({
          allowedEfforts: ['low'],
          efforts: { planner: 'high' },
        }),
      ),
    ).toThrow(/allowedEfforts/)
    expect(() => loadModelsConfig(JSON.stringify({ temperature: 0 }))).toThrow(
      /invalid/,
    )
    expect(() => loadModelsConfig('{nope')).toThrow(/not valid JSON/)
  })

  it('merges top-level keys over the default (critic override example from §9)', () => {
    const c = loadModelsConfig(
      JSON.stringify({
        roleOverrides: {
          critic: { models: [{ model: 'gpt-6-astra', effort: 'low' }] },
        },
      }),
    )
    expect(c.tiers).toEqual(DEFAULT_MODELS.tiers)
    expect(resolveRoute(c, 'critic').chain).toEqual([
      { model: 'gpt-6-astra', effort: 'low' },
    ])
  })
})

describe('resolveRoute', () => {
  it('always yields an explicit effort for every role and model', () => {
    for (const role of RoleName.options) {
      for (const run of resolveRoute(DEFAULT_MODELS, role).chain)
        expect(['low', 'medium', 'high']).toContain(run.effort)
    }
  })

  it('runs the concept pass on gpt-6-luna at medium (ADR 0058)', () => {
    expect(resolveRoute(DEFAULT_MODELS, 'indexer')).toEqual({
      tier: 'fast',
      chain: [{ model: 'gpt-6-luna', effort: 'medium' }],
    })
    expect(resolveRoute(DEFAULT_MODELS, 'glossary').chain).toEqual([
      { model: 'gpt-6-luna', effort: 'medium' },
    ])
  })

  it('escalates the indexer to gpt-6.1-sol at high', () => {
    expect(resolveRoute(DEFAULT_MODELS, 'indexer', true)).toEqual({
      tier: 'standard',
      chain: [{ model: 'gpt-6.1-sol', effort: 'high' }],
    })
  })

  it('runs every other role on gpt-6.1-sol with the role effort (ADR 0046)', () => {
    expect(resolveRoute(DEFAULT_MODELS, 'book-summary')).toEqual({
      tier: 'standard',
      chain: [{ model: 'gpt-6.1-sol', effort: 'medium' }],
    })
    expect(resolveRoute(DEFAULT_MODELS, 'planner').chain).toEqual([
      { model: 'gpt-6.1-sol', effort: 'medium' },
    ])
    expect(resolveRoute(DEFAULT_MODELS, 'extractor.chart').chain).toEqual([
      { model: 'gpt-6.1-sol', effort: 'low' },
    ])
    expect(resolveRoute(DEFAULT_MODELS, 'translator').chain).toEqual([
      { model: 'gpt-6.1-sol', effort: 'high' },
    ])
    for (const role of RoleName.options)
      if (role !== 'indexer' && role !== 'glossary')
        for (const run of resolveRoute(DEFAULT_MODELS, role).chain)
          expect(run.model).toBe('gpt-6.1-sol')
  })

  it('escalates to deep: gpt-6.1-sol at high', () => {
    expect(resolveRoute(DEFAULT_MODELS, 'planner', true)).toEqual({
      tier: 'deep',
      chain: [{ model: 'gpt-6.1-sol', effort: 'high' }],
    })
    expect(resolveRoute(DEFAULT_MODELS, 'translator', true).chain[0]).toEqual({
      model: 'gpt-6.1-sol',
      effort: 'high',
    })
    expect(() => resolveRoute(DEFAULT_MODELS, 'critic', true)).toThrow(
      /no escalation tier/,
    )
  })
})
