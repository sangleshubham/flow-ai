import { LlmError } from '@illus/core'
import type { LlmCall } from '@illus/core'
import { describe, expect, test } from 'vitest'

import { createLimiter, limitLlm } from '../src/index.ts'
import type { Priority } from '../src/index.ts'

/** A task that records its start and finishes when `finish()` is called. */
function task(name: string, started: string[]) {
  let finish!: () => void
  const done = new Promise<void>((r) => (finish = r))
  return {
    fn: () => {
      started.push(name)
      return done.then(() => name)
    },
    finish,
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe('createLimiter', () => {
  test('is FIFO within one class and defaults to foreground', async () => {
    const lim = createLimiter(1)
    const started: string[] = []
    const a = task('a', started)
    const b = task('b', started)
    const c = task('c', started)
    const pa = lim.run(a.fn)
    const pb = lim.run(b.fn)
    const pc = lim.run(c.fn)
    expect(started).toEqual(['a'])
    expect(lim.active).toBe(1)
    expect(lim.queued).toBe(2)
    a.finish()
    await pa
    expect(started).toEqual(['a', 'b'])
    b.finish()
    await pb
    c.finish()
    await pc
    expect(started).toEqual(['a', 'b', 'c'])
    expect(lim.active).toBe(0)
  })

  test('is FIFO within the background class', async () => {
    const lim = createLimiter(1)
    const started: string[] = []
    const bg = (): Priority => 'background'
    const a = task('a', started)
    const b = task('b', started)
    const c = task('c', started)
    const ps = [
      lim.run(a.fn, undefined, bg),
      lim.run(b.fn, undefined, bg),
      lim.run(c.fn, undefined, bg),
    ]
    a.finish()
    b.finish()
    c.finish()
    await Promise.all(ps)
    expect(started).toEqual(['a', 'b', 'c'])
  })

  test('a queued foreground task starts before older background ones', async () => {
    const lim = createLimiter(1)
    const started: string[] = []
    const bg = (): Priority => 'background'
    const run = task('run', started)
    const b1 = task('b1', started)
    const b2 = task('b2', started)
    const f = task('f', started)
    const ps = [
      lim.run(run.fn, undefined, bg),
      lim.run(b1.fn, undefined, bg),
      lim.run(b2.fn, undefined, bg),
      lim.run(f.fn),
    ]
    expect(started).toEqual(['run'])
    run.finish()
    await ps[0]
    expect(started).toEqual(['run', 'f'])
    f.finish()
    await ps[3]
    b1.finish()
    b2.finish()
    await Promise.all(ps)
    expect(started).toEqual(['run', 'f', 'b1', 'b2'])
  })

  test('background never exceeds maxBackground even when total slots are free', async () => {
    const lim = createLimiter(5, { maxBackground: 2 })
    const started: string[] = []
    const bg = (): Priority => 'background'
    const ts = ['a', 'b', 'c', 'd'].map((n) => task(n, started))
    const ps = ts.map((t) => lim.run(t.fn, undefined, bg))
    expect(started).toEqual(['a', 'b'])
    expect(lim.active).toBe(2)
    expect(lim.activeBackground).toBe(2)
    expect(lim.queued).toBe(2)
    ts[0]!.finish()
    await ps[0]
    expect(started).toEqual(['a', 'b', 'c'])
    expect(lim.activeBackground).toBe(2)
    for (const t of ts) t.finish()
    await Promise.all(ps)
    expect(lim.activeBackground).toBe(0)
  })

  test('with total 5 and both caps at 4, a foreground task starts while 4 background tasks run', async () => {
    const lim = createLimiter(5, { maxForeground: 4, maxBackground: 4 })
    const started: string[] = []
    const bg = (): Priority => 'background'
    const bgs = ['b1', 'b2', 'b3', 'b4', 'b5'].map((n) => task(n, started))
    const bgPs = bgs.map((t) => lim.run(t.fn, undefined, bg))
    expect(started).toEqual(['b1', 'b2', 'b3', 'b4'])
    const f = task('f', started)
    const fp = lim.run(f.fn)
    expect(started).toEqual(['b1', 'b2', 'b3', 'b4', 'f'])
    expect(lim.active).toBe(5)
    expect(lim.activeBackground).toBe(4)
    f.finish()
    await fp
    for (const t of bgs) t.finish()
    await Promise.all(bgPs)
  })

  test('maxForeground caps foreground tasks', async () => {
    const lim = createLimiter(5, { maxForeground: 1 })
    const started: string[] = []
    const f1 = task('f1', started)
    const f2 = task('f2', started)
    const b = task('b', started)
    const ps = [
      lim.run(f1.fn),
      lim.run(f2.fn),
      lim.run(b.fn, undefined, () => 'background'),
    ]
    // f2 is blocked by the foreground cap but must not block the background task behind it.
    expect(started).toEqual(['f1', 'b'])
    f1.finish()
    await ps[0]
    expect(started).toEqual(['f1', 'b', 'f2'])
    f2.finish()
    b.finish()
    await Promise.all(ps)
  })

  test('dynamic promotion: a queued background task that turns foreground jumps the queue', async () => {
    const lim = createLimiter(1)
    const started: string[] = []
    let pri: Priority = 'background'
    const run = task('run', started)
    const b1 = task('b1', started)
    const b2 = task('b2', started)
    const ps = [
      lim.run(run.fn),
      lim.run(b1.fn, undefined, () => 'background'),
      lim.run(b2.fn, undefined, () => pri),
    ]
    pri = 'foreground'
    run.finish()
    await ps[0]
    expect(started).toEqual(['run', 'b2'])
    b2.finish()
    await ps[2]
    b1.finish()
    await Promise.all(ps)
    expect(started).toEqual(['run', 'b2', 'b1'])
  })

  test('a task decrements the counter of the class it started with', async () => {
    const lim = createLimiter(5, { maxBackground: 1 })
    const started: string[] = []
    let pri: Priority = 'background'
    const a = task('a', started)
    const pa = lim.run(a.fn, undefined, () => pri)
    expect(lim.activeBackground).toBe(1)
    pri = 'foreground'
    a.finish()
    await pa
    expect(lim.activeBackground).toBe(0)
    expect(lim.active).toBe(0)
  })

  test('abort while queued rejects with LlmError(aborted) and starts the next task', async () => {
    const lim = createLimiter(1)
    const started: string[] = []
    const run = task('run', started)
    const next = task('next', started)
    const ac = new AbortController()
    const p0 = lim.run(run.fn)
    const p1 = lim.run(() => {
      started.push('never')
      return Promise.resolve('never')
    }, ac.signal)
    const p2 = lim.run(next.fn)
    expect(lim.queued).toBe(2)
    ac.abort()
    const err = await p1.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect((err as LlmError).code).toBe('aborted')
    expect(lim.queued).toBe(1)
    run.finish()
    await p0
    expect(started).toEqual(['run', 'next'])
    next.finish()
    await p2
    expect(lim.active).toBe(0)
  })

  test('an aborted queued task does not block the task queued behind it', async () => {
    const lim = createLimiter(2, { maxBackground: 1 })
    const started: string[] = []
    const b1 = task('b1', started)
    const b2 = task('b2', started)
    const b3 = task('b3', started)
    const bg = (): Priority => 'background'
    const ac = new AbortController()
    const p1 = lim.run(b1.fn, undefined, bg)
    const p2 = lim.run(b2.fn, ac.signal, bg)
    const p3 = lim.run(b3.fn, undefined, bg)
    ac.abort()
    await expect(p2).rejects.toBeInstanceOf(LlmError)
    expect(started).toEqual(['b1'])
    b1.finish()
    await p1
    expect(started).toEqual(['b1', 'b3'])
    b3.finish()
    await p3
    expect(lim.queued).toBe(0)
  })

  test('poke starts a queued task whose priority changed while slots were free', async () => {
    const lim = createLimiter(5, { maxBackground: 1 })
    const started: string[] = []
    let pri: Priority = 'background'
    const b1 = task('b1', started)
    const b2 = task('b2', started)
    const p1 = lim.run(b1.fn, undefined, () => 'background')
    const p2 = lim.run(b2.fn, undefined, () => pri)
    expect(started).toEqual(['b1'])
    pri = 'foreground'
    lim.poke()
    expect(started).toEqual(['b1', 'b2'])
    b1.finish()
    b2.finish()
    await Promise.all([p1, p2])
  })

  test('a task that throws synchronously rejects and frees its slot', async () => {
    const lim = createLimiter(1)
    const started: string[] = []
    const ok = task('ok', started)
    const bad = lim.run(() => {
      throw new Error('boom')
    })
    await expect(bad).rejects.toThrow('boom')
    expect(lim.active).toBe(0)
    const p = lim.run(ok.fn)
    ok.finish()
    await p
  })
})

describe('limitLlm', () => {
  test('passes the priority lookup the call signal and defaults to foreground', async () => {
    const lim = createLimiter(1)
    const order: string[] = []
    const llm: LlmCall = {
      call: async (role) => {
        order.push(String(role))
        return {} as never
      },
    }
    const seen: (AbortSignal | undefined)[] = []
    const bgSignal = new AbortController().signal
    const limited = limitLlm(llm, lim, (signal) => {
      seen.push(signal)
      return signal === bgSignal ? 'background' : 'foreground'
    })
    const blocker = task('blocker', [])
    const pb = lim.run(blocker.fn)
    const p1 = limited.call(
      'planner' as never,
      {} as never,
      { signal: bgSignal } as never,
    )
    const p2 = limited.call('critic' as never, {} as never)
    blocker.finish()
    await Promise.all([pb, p1, p2])
    await tick()
    expect(order).toEqual(['critic', 'planner'])
    expect(seen).toContain(bgSignal)

    // Without a lookup everything is foreground (backward compatible).
    const plain = limitLlm(llm, createLimiter(1))
    await plain.call('planner' as never, {} as never)
  })
})
