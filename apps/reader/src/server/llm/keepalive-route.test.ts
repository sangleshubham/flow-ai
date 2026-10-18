import { EventEmitter } from 'node:events'

import type { NextApiRequest, NextApiResponse } from 'next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import handler from '../../pages/api/llm'

const { handle, verify } = vi.hoisted(() => ({
  handle: vi.fn(),
  verify: vi.fn(),
}))
vi.mock('./index', () => ({
  getIllusServer: async () => ({ gateway: { handle }, sessions: { verify } }),
}))

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
    write: vi.fn(),
    end: vi.fn((_body: string) => {
      res.writableEnded = true
      res.emit('close')
    }),
  })
  return res
}

const req = {
  method: 'POST',
  headers: { cookie: 'session-cookie' },
  body: { requestId: 'test' },
} as NextApiRequest

beforeEach(() => {
  vi.useFakeTimers()
  verify.mockReturnValue({ sub: 'test' })
})
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
  vi.resetAllMocks()
})

it('uses no-transform and keeps the fast gateway status without aborting on normal completion', async () => {
  const res = response()
  const body = { ok: false, code: 'auth', message: 'Sign in' }
  handle.mockResolvedValue({ status: 401, body })
  await handler(req, res as unknown as NextApiResponse)
  expect(res.setHeader).toHaveBeenCalledWith(
    'Cache-Control',
    'no-store, no-transform',
  )
  expect(verify).toHaveBeenCalledWith('session-cookie')
  expect(handle).toHaveBeenCalledWith(req.body, {
    sub: 'test',
    signal: expect.any(AbortSignal),
  })
  expect(handle.mock.calls[0]![1].signal.aborted).toBe(false)
  expect(res.statusCode).toBe(401)
  expect(res.end).toHaveBeenCalledExactlyOnceWith(JSON.stringify(body))
  expect(res.write).not.toHaveBeenCalled()
})

it('keeps aborting the upstream call when a slow response disconnects', async () => {
  const res = response()
  let resolve!: (result: { status: number; body: unknown }) => void
  handle.mockReturnValue(
    new Promise((yes) => {
      resolve = yes
    }),
  )
  const done = handler(req, res as unknown as NextApiResponse)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(res.write).toHaveBeenCalledExactlyOnceWith(' ')
  res.emit('close')
  expect(handle.mock.calls[0]![1].signal.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
  resolve({ status: 200, body: { ok: true } })
  await done
  expect(res.end).not.toHaveBeenCalled()
})

it('forwards an explicit recheck header to the authenticated gateway context', async () => {
  const res = response()
  handle.mockResolvedValue({
    status: 429,
    body: { ok: false, code: 'plan-limit', message: 'limit' },
  })
  await handler(
    {
      ...req,
      headers: { ...req.headers, 'x-illus-recheck-plan-limit': '1' },
    } as unknown as NextApiRequest,
    res as unknown as NextApiResponse,
  )
  expect(handle).toHaveBeenCalledWith(req.body, {
    sub: 'test',
    signal: expect.any(AbortSignal),
    recheckPlanLimit: true,
  })
})
