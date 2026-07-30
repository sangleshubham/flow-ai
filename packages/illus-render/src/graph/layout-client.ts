// Main-thread side of the layout worker: `layoutGraph()` (§20 W4 contract, `LayoutGraphFn`).
import * as Comlink from 'comlink'

import type { LayoutGraphFn, LayoutGraphResult } from '@illus/core'

import type { LayoutApi } from './layout.worker.ts'

let remote: Comlink.Remote<LayoutApi> | undefined

function api(): Comlink.Remote<LayoutApi> {
  remote ??= Comlink.wrap<LayoutApi>(
    new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module', name: 'illus-layout' }),
  )
  return remote
}

// Same input → same layout, so re-renders skip ELK. Callers persist results in VisualRecord.layout for
// cross-session reuse (§10).
// ponytail: FIFO eviction at 200 entries; switch to LRU if eviction ever shows up in profiles.
const cache = new Map<string, Promise<LayoutGraphResult>>()
const MAX_CACHE = 200

/** ELK layout in the layout worker. `hints` switch ELK to interactive mode (§11, §13). */
export const layoutGraph: LayoutGraphFn = (input, opts) => {
  const key = JSON.stringify(input)
  let p = cache.get(key)
  if (!p) {
    p = api().layout(input)
    cache.set(key, p)
    p.catch(() => cache.delete(key))
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!)
  }
  return abortable(p, opts?.signal)
}

function abortable<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}
