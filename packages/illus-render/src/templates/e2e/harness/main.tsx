// Template harness: `/#<fixture>:<light|dark>` renders one template fixture through VisualView, in a fake
// Flow theme, and records evidence events and CSP violations for the Playwright specs.
import { createRoot } from 'react-dom/client'

import { useFlowTheme, VisualView } from '../../../index.ts'
import type { EvidenceEvent } from '../../../index.ts'
import { templateRegistry } from '../../index.ts'
import { TEMPLATE_FIXTURES } from '../fixtures.ts'

declare global {
  interface Window {
    __events: { type: 'hover' | 'click'; e: EvidenceEvent | null }[]
    __csp: string[]
  }
}

const [name = 'array', themeName = 'light'] = location.hash.slice(1).split(':')
document.documentElement.classList.toggle('dark', themeName === 'dark')
window.__events = []
window.__csp = []
document.addEventListener('securitypolicyviolation', (e) => {
  if (!/\/zod\.js/.test(e.sourceFile)) window.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`)
})

const fixture = TEMPLATE_FIXTURES[name]
if (!fixture) throw new Error(`unknown fixture ${name}`)

function App() {
  const theme = useFlowTheme()
  return (
    <VisualView
      spec={{ ir: fixture!.ir, groundingScore: 1 }}
      {...(fixture!.frame ? { frame: fixture!.frame } : {})}
      theme={theme}
      templates={templateRegistry}
      onEvidenceHover={(e) => window.__events.push({ type: 'hover', e })}
      onEvidenceClick={(e) => window.__events.push({ type: 'click', e })}
    />
  )
}

createRoot(document.getElementById('root')!).render(<App />)
