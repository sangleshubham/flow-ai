// Harness entry: `/#<fixture>:<light|dark>` renders one fixture in a fake Flow theme and records
// evidence events, CSP violations and sandbox probe results on `window` for the Playwright specs.
import 'katex/dist/katex.min.css'

import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import {
  exportPng,
  exportSvg,
  irElements,
  layoutGraph,
  readFlowTheme,
  useFlowTheme,
  VisualView,
} from '../../src/index.ts'
import type { EvidenceEvent } from '../../src/index.ts'

import { FIXTURES } from './fixtures.ts'

declare global {
  interface Window {
    __events: { type: 'hover' | 'click'; e: EvidenceEvent | null }[]
    __csp: string[]
    __probe?: unknown
    __xss?: unknown
    __evidenceIds: string[]
    __actions: string[]
    __exportSvg: () => string
    __exportPngBlob: (scale?: number) => Promise<Blob>
    __exportPng: () => Promise<{ width: number; height: number; bytes: number }>
    __layout: typeof layoutGraph
  }
}

const [name = 'graph', themeName = 'light'] = location.hash.slice(1).split(':')
document.documentElement.classList.toggle('dark', themeName === 'dark')
window.__events = []
window.__csp = []
window.__actions = []
// Zod 4 probes `new Function` once (caught) to decide on its JIT; the app silences it with
// `z.config({ jitless: true })`. Every other violation fails the specs.
document.addEventListener('securitypolicyviolation', (e) => {
  if (!/\/zod\.js/.test(e.sourceFile))
    window.__csp.push(
      `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`,
    )
})
window.addEventListener('message', (e) => {
  if (e.data && typeof e.data === 'object' && 'probe' in e.data)
    window.__probe = e.data.probe
})
window.__layout = layoutGraph

const fixture = FIXTURES[name]
if (!fixture) throw new Error(`unknown fixture ${name}`)
window.__evidenceIds = irElements(fixture.spec.ir)
  .filter((e) => e.evidence)
  .map((e) => e.id)

function App() {
  const theme = useFlowTheme()
  const [vote, setVote] = useState<'up' | 'down'>()
  window.__exportSvg = () =>
    exportSvg(document.querySelector('.illus-canvas svg')!, readFlowTheme())
  window.__exportPngBlob = (scale) =>
    exportPng(
      document.querySelector('.illus-canvas svg')!,
      readFlowTheme(),
      scale,
    )
  window.__exportPng = async () => {
    const blob = await window.__exportPngBlob()
    const bmp = await createImageBitmap(blob)
    return { width: bmp.width, height: bmp.height, bytes: blob.size }
  }
  return (
    <VisualView
      spec={fixture!.spec}
      frame={fixture!.frame}
      theme={theme}
      flags={{ htmlFallback: fixture!.htmlFallback ?? false }}
      onEvidenceHover={(e) => window.__events.push({ type: 'hover', e })}
      onEvidenceClick={(e) => window.__events.push({ type: 'click', e })}
      actions={{
        onRegenerate: () => window.__actions.push('regenerate'),
        onKindOverride: (k) => window.__actions.push(`kind:${k}`),
        onVote: (v) => {
          setVote(v)
          window.__actions.push(`vote:${v}`)
        },
        ...(vote ? { vote } : {}),
        onShowEvidence: () => window.__actions.push('evidence'),
      }}
    />
  )
}

createRoot(document.getElementById('root')!).render(<App />)
