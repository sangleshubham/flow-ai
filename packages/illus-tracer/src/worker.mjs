// Bootstrap is trusted and self-hosted. No user Python runs before ready completes.
import { expose } from './illus-comlink.mjs'
import { loadPyodide } from './pyodide/pyodide.mjs'

const boot = (async () => {
  const pythonSource = await fetch(
    new URL('./illus-tracer.py', import.meta.url),
  ).then((r) => {
    if (!r.ok) throw new Error('Cannot load trace harness')
    return r.text()
  })
  const runtime = await loadPyodide({
    indexURL: new URL('./pyodide/', import.meta.url).href,
  })
  runtime.runPython(pythonSource)
  // Cover inherited worker globals as well as own properties, prevent later reassignment.
  for (const key of [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'importScripts',
    'Worker',
    'SharedWorker',
    'WebTransport',
    'RTCPeerConnection',
    'navigator',
    'caches',
    'indexedDB',
  ]) {
    Object.defineProperty(globalThis, key, {
      value: undefined,
      writable: false,
      configurable: false,
    })
  }
  return runtime
})()
// Install the RPC listener immediately: the host's ready request must not disappear during boot.
expose({
  async ready() {
    await boot
    return true
  },
  async run(python, entry, focusFunctions) {
    const runtime = await boot
    if (
      typeof python !== 'string' ||
      python.length > 100_000 ||
      typeof entry !== 'string' ||
      entry.length > 10_000 ||
      !Array.isArray(focusFunctions) ||
      focusFunctions.length > 50
    )
      throw new Error('Trace input exceeds limits')
    runtime.globals.set(
      '_request_json',
      JSON.stringify({ python, entry, focusFunctions }),
    )
    return JSON.parse(runtime.runPython('_trace_json(_request_json)'))
  },
})
