import { describe, expect, it } from 'vitest'
import { make as factories, createMemoryRepos } from '@illus/core/testing'
import {
  createTraceRunner,
  createCachedTraceRunner,
  TraceFallbackError,
} from '../src/runner.ts'

describe('trace runner', () => {
  it('rejects unmapped executed lines rather than showing ungrounded highlights', async () => {
    const runner = createTraceRunner({
      worker: {
        run: async () => ({
          steps: [factories.traceStep({ pyLine: 5 })],
          truncated: false,
        }),
      },
    })
    await expect(
      runner.runTrace({
        codeBlockId: 'b',
        translation: factories.translation({ lineMap: [{ py: 1, orig: [1] }] }),
      }),
    ).rejects.toMatchObject({
      route: 'simulated-template',
      reason: 'Missing original line mapping for Python line 5',
    })
  })
  it('maps original lines, runs both scenarios and repairs at most twice', async () => {
    let attempts = 0,
      fixes = 0
    const translation = factories.translation({
      scenarios: [
        { label: 'a', entry: 'f(1)' },
        { label: 'b', entry: 'f(2)' },
      ],
      lineMap: [{ py: 1, orig: [5] }],
    })
    const runner = createTraceRunner({
      worker: {
        run: async () =>
          ++attempts <= 2
            ? { steps: [], truncated: false, error: 'broken' }
            : { steps: [factories.traceStep({ pyLine: 1 })], truncated: false },
      },
      fixer: async () => {
        fixes++
        return translation
      },
    })
    const out = await runner.runTrace({ codeBlockId: 'b', translation })
    expect(fixes).toBe(2)
    expect(out).toHaveLength(2)
    expect(out[0]?.trace.steps[0]?.origLines).toEqual([5])
  })
  it('signals a labelled simulated fallback after two repairs', async () => {
    let fixes = 0
    const runner = createTraceRunner({
      worker: {
        run: async () => ({ steps: [], truncated: false, error: 'timeout' }),
      },
      fixer: async (t) => {
        fixes++
        return t
      },
    })
    await expect(
      runner.runTrace({
        codeBlockId: 'b',
        translation: factories.translation(),
      }),
    ).rejects.toMatchObject({ route: 'simulated-template' })
    expect(fixes).toBe(2)
  })
  it('does not execute untraceable code', async () => {
    const runner = createTraceRunner({
      worker: {
        run: async () => {
          throw new Error('must not run')
        },
      },
    })
    await expect(
      runner.runTrace({
        codeBlockId: 'b',
        translation: factories.translation({
          traceable: false,
          reason: 'goroutines communicate concurrently',
        }),
      }),
    ).rejects.toMatchObject({ route: 'timeline' })
    await expect(
      runner.runTrace({
        codeBlockId: 'b',
        translation: factories.translation({
          traceable: false,
          reason: 'file IO',
        }),
      }),
    ).rejects.toBeInstanceOf(TraceFallbackError)
  })
  it('caches through repos and respects stale entries', async () => {
    const repos = createMemoryRepos()
    let calls = 0
    const runner = createCachedTraceRunner({
      repos,
      bookId: 'book',
      codeSource: 'source',
      translator: { promptVersion: '1', model: 'test', effort: 'low' },
      worker: {
        run: async () => {
          calls++
          return { steps: [], truncated: false }
        },
      },
    })
    const input = {
      codeBlockId: 'b',
      translation: factories.translation({
        scenarios: [{ label: 'one', entry: 'f()' }],
      }),
    }
    await runner.runTrace(input)
    await runner.runTrace(input)
    expect(calls).toBe(1)
    const record = (await repos.traces.listByCodeBlock('b'))[0]!
    await repos.traces.put({ ...record, stale: true })
    await runner.runTrace(input)
    expect(calls).toBe(2)
  })
})
