import React from 'react'
import { createRoot } from 'react-dom/client'
import {
  createBrowserTraceWorker,
  createTraceRunner,
  TraceView,
} from '../../src/index.ts'
import { make } from '@illus/core/testing'
const worker = createBrowserTraceWorker()
const python =
  'def search(a, target):\n  lo, hi = 0, len(a)-1\n  while lo <= hi:\n    mid = (lo+hi)//2\n    if a[mid] == target:\n      return mid\n    if a[mid] < target:\n      lo = mid+1\n    else:\n      hi = mid-1\n  return -1'
const translation = make.translation({
  python,
  scenarios: [
    { label: 'Found', entry: 'search([1,3,5,7,9],7)' },
    { label: 'Missing', entry: 'search([1,3,5,7,9],8)' },
  ],
  lineMap: python.split('\n').map((_, i) => ({ py: i + 1, orig: [i + 1] })),
  focusFunctions: ['search'],
  vizHints: [
    { variable: 'a', template: 'array' },
    { variable: 'lo', template: 'array', pointerOf: 'a' },
    { variable: 'mid', template: 'array', pointerOf: 'a' },
    { variable: 'hi', template: 'array', pointerOf: 'a' },
  ],
  assumptions: ['Go fixed-width integer overflow is not modelled.'],
})
const api = {
  run: (code: string, entry: string, focus: string[] = []) =>
    worker.run(code, entry, focus),
  async render() {
    const scenarios = await createTraceRunner({ worker }).runTrace({
      codeBlockId: 'fixture',
      translation,
    })
    const record = make.traceRecord({
      cacheKey: 'fixture',
      translation,
      scenarios,
      mode: 'executed',
    })
    createRoot(document.getElementById('root')!).render(
      <TraceView
        record={record}
        originalCode={python}
        langHint="python"
        flags={{ tracer: true }}
      />,
    )
    return scenarios
  },
}
declare global {
  interface Window {
    traceHarness: typeof api
  }
}
window.traceHarness = api
