import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { respondWithKeepAlive } from './keepalive'

function response() {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    setHeader: vi.fn(),
    writeHead: vi.fn((status: number) => {
      res.statusCode = status
      res.headersSent = true
    }),
    flushHeaders: vi.fn(),
    write: vi.fn((_chunk: string) => true),
    end: vi.fn((_body: string) => {
      res.writableEnded = true
      res.emit('close')
    }),
  })
  return { res, http: res as unknown as ServerResponse }
}

function deferred() {
  let resolve!: (result: { status: number; body: unknown }) => void
  let reject!: (error: Error) => void
  const pending = new Promise<{ status: number; body: unknown }>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { pending, resolve, reject }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
})

describe('respondWithKeepAlive', () => {
  it('preserves the fast result status and JSON without heartbeat bytes', async () => {
    const { res, http } = response()
    const { pending, resolve } = deferred()
    const done = respondWithKeepAlive(http, pending)
    await vi.advanceTimersByTimeAsync(5_000)
    const body = { ok: false, code: 'auth', message: 'Sign in' }
    resolve({ status: 401, body })
    await done

    expect(res.statusCode).toBe(401)
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/json; charset=utf-8',
    )
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(body))
    expect(res.writeHead).not.toHaveBeenCalled()
    expect(res.flushHeaders).not.toHaveBeenCalled()
    expect(res.write).not.toHaveBeenCalled()
    expect(res.listenerCount('close')).toBe(0)
  })

  it('flushes 200 headers at 10 s and writes JSON-compatible spaces every 15 s', async () => {
    const { res, http } = response()
    const { pending, resolve } = deferred()
    const done = respondWithKeepAlive(http, pending)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(res.writeHead).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(res.writeHead).toHaveBeenCalledExactlyOnceWith(200, {
      'Content-Type': 'application/json; charset=utf-8',
    })
    expect(res.flushHeaders).toHaveBeenCalledOnce()
    expect(res.write).toHaveBeenCalledExactlyOnceWith(' ')
    await vi.advanceTimersByTimeAsync(15_000)
    expect(res.write).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(res.write).toHaveBeenCalledTimes(3)
    const body = { ok: true, data: { value: 42 } }
    resolve({ status: 200, body })
    await done

    expect(res.end).toHaveBeenCalledExactlyOnceWith(JSON.stringify(body))
    const spaces = res.write.mock.calls.map(([chunk]) => chunk).join('')
    expect(JSON.parse(spaces + res.end.mock.calls[0]![0])).toEqual(body)
    expect(res.listenerCount('close')).toBe(0)
  })

  it('retains a slow error body under the already-sent 200 status', async () => {
    const { res, http } = response()
    const { pending, resolve } = deferred()
    const done = respondWithKeepAlive(http, pending)
    await vi.advanceTimersByTimeAsync(10_000)
    const body = { ok: false, code: 'timeout', message: 'Model timed out' }
    resolve({ status: 504, body })
    await done
    expect(res.statusCode).toBe(200)
    expect(res.end).toHaveBeenCalledExactlyOnceWith(JSON.stringify(body))
  })

  it.each([5_000, 25_000])(
    'clears timers and preserves a rejection at %i ms',
    async (at) => {
      const { res, http } = response()
      const { pending, reject } = deferred()
      const done = respondWithKeepAlive(http, pending)
      const error = new Error('gateway failed')
      const rejected = expect(done).rejects.toBe(error)
      await vi.advanceTimersByTimeAsync(at)
      reject(error)
      await rejected
      expect(res.end).not.toHaveBeenCalled()
      expect(res.listenerCount('close')).toBe(0)
    },
  )

  it.each([5_000, 25_000])(
    'stops on close at %i ms without writing a late result',
    async (at) => {
      const { res, http } = response()
      const { pending, resolve } = deferred()
      const done = respondWithKeepAlive(http, pending)
      await vi.advanceTimersByTimeAsync(at)
      res.emit('close')
      expect(vi.getTimerCount()).toBe(0)
      const writes = res.write.mock.calls.length
      await vi.advanceTimersByTimeAsync(60_000)
      resolve({ status: 200, body: { ok: true } })
      await done
      expect(res.write).toHaveBeenCalledTimes(writes)
      expect(res.end).not.toHaveBeenCalled()
      expect(res.listenerCount('close')).toBe(0)
    },
  )

  it.each(['destroyed', 'writableEnded'] as const)(
    'does not write when already %s',
    async (state) => {
      const { res, http } = response()
      res[state] = true
      const { pending, resolve } = deferred()
      const done = respondWithKeepAlive(http, pending)
      await vi.advanceTimersByTimeAsync(40_000)
      resolve({ status: 200, body: { ok: true } })
      await done
      expect(res.writeHead).not.toHaveBeenCalled()
      expect(res.write).not.toHaveBeenCalled()
      expect(res.end).not.toHaveBeenCalled()
    },
  )

  it('preserves pending rejection after disconnect', async () => {
    const { res, http } = response()
    const { pending, reject } = deferred()
    const done = respondWithKeepAlive(http, pending)
    const error = new Error('upstream aborted')
    const rejected = expect(done).rejects.toBe(error)
    await vi.advanceTimersByTimeAsync(10_000)
    res.emit('close')
    reject(error)
    await rejected
    expect(res.end).not.toHaveBeenCalled()
    expect(res.listenerCount('close')).toBe(0)
  })
})
