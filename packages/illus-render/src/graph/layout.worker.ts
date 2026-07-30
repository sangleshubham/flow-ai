// Dedicated layout worker (§3, §10): elkjs runs here, exposed through Comlink.
import './elk-shim.ts'

import * as Comlink from 'comlink'
import ELK from 'elkjs/lib/elk.bundled.js'

import type { LayoutGraphInput } from '@illus/core'

import { runElkLayout } from './elk.ts'

const g = globalThis as { document?: unknown; __illusElkShim?: boolean }
if (g.__illusElkShim) {
  delete g.document
  delete g.__illusElkShim
}

const elk = new ELK()

export const layoutApi = {
  layout: (input: LayoutGraphInput) => runElkLayout(elk, input),
}
export type LayoutApi = typeof layoutApi

Comlink.expose(layoutApi)
