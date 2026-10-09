import { MessageChannel } from 'node:worker_threads'
import { expose } from 'comlink'
import type { Endpoint } from 'comlink'
import { describe, expect, it } from 'vitest'
import { createBrowserTraceWorker } from '../src/browser-worker.ts'

function factory(run: (entry: string, instance: number) => Promise<unknown>) {
  let instances = 0,
    terminations = 0
  return {
    get instances() {
      return instances
    },
    get terminations() {
      return terminations
    },
    create: () => {
      const { port1, port2 } = new MessageChannel(),
        instance = ++instances
      expose(
        {
          ready: () => true,
          run: (_python: string, entry: string) => run(entry, instance),
        },
        port2 as unknown as Endpoint,
      )
      return Object.assign(port1, {
        terminate: () => {
          terminations++
          port1.close()
          port2.close()
        },
      }) as unknown as Worker
    },
  }
}
const good = { steps: [], truncated: false }
describe('main-thread trace worker ownership', () => {
  it('serializes concurrent runs in one worker', async () => {
    let active = 0,
      maximum = 0
    const mock = factory(async () => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise((r) => setTimeout(r, 10))
      active--
      return good
    })
    const worker = createBrowserTraceWorker({ workerFactory: mock.create })
    await Promise.all([worker.run('', '1', []), worker.run('', '2', [])])
    expect(maximum).toBe(1)
    expect(mock.instances).toBe(1)
    worker.dispose()
  })
  it('terminates and respawns after timeout, without poisoning the queue', async () => {
    const mock = factory(async (_, instance) =>
      instance === 1 ? new Promise(() => undefined) : good,
    )
    const worker = createBrowserTraceWorker({
      workerFactory: mock.create,
      timeoutMs: 30,
    })
    expect(await worker.run('', '1', [])).toMatchObject({ error: 'timeout' })
    expect(mock.terminations).toBe(1)
    expect(await worker.run('', '2', [])).toEqual(good)
    expect(mock.instances).toBe(2)
    worker.dispose()
  })
  it('aborts active work and rejects cancelled queued work without executing it', async () => {
    const mock = factory(async () => new Promise(() => undefined))
    const worker = createBrowserTraceWorker({ workerFactory: mock.create })
    const active = new AbortController(),
      queued = new AbortController()
    const first = worker.run('', '1', [], { signal: active.signal })
    const second = worker.run('', '2', [], { signal: queued.signal })
    const firstCheck = expect(first).rejects.toMatchObject({
      name: 'AbortError',
    })
    const secondCheck = expect(second).rejects.toMatchObject({
      name: 'AbortError',
    })
    await new Promise((r) => setTimeout(r, 10))
    queued.abort()
    active.abort()
    await Promise.all([firstCheck, secondCheck])
    expect(mock.instances).toBe(1)
    expect(mock.terminations).toBe(1)
    worker.dispose()
  })
})
