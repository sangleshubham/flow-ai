// elk.bundled.js registers itself as a raw worker (`self.onmessage`) when it sees a worker global without
// `document`, which would fight Comlink. A placeholder `document` while the module evaluates makes it
// export its in-thread FakeWorker instead; layout.worker.ts removes the placeholder right after.
const g = globalThis as { document?: unknown; __illusElkShim?: boolean }
if (g.document === undefined) {
  g.document = {}
  g.__illusElkShim = true
}
export {}
