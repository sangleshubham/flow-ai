// HTML fallback (§10, §17): the model's HTML runs only inside the sandbox page, in an iframe with
// `sandbox="allow-scripts"` and no `allow-same-origin`, so it cannot reach cookies, IndexedDB or the
// parent DOM. The HTML is passed by postMessage; the sandbox page writes it into its own document.
import { useRef } from 'react'

import type { HtmlIR } from '@illus/core'

export const SANDBOX_URL = '/illus-sandbox.html'
export const SANDBOX_MESSAGE = 'illus-html'

export function HtmlFallbackView({ ir, sandboxUrl = SANDBOX_URL, onReady }: { ir: HtmlIR; sandboxUrl?: string; onReady: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  return (
    <iframe
      // A new iframe per HTML: the sandbox page accepts one document only.
      key={ir.html}
      ref={frame}
      className="illus-iframe"
      title="Unverified HTML explainer"
      src={sandboxUrl}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      onLoad={() => {
        // The sandboxed document has an opaque origin, so '*' is the only target origin that reaches it.
        frame.current?.contentWindow?.postMessage({ type: SANDBOX_MESSAGE, html: ir.html }, '*')
        onReady()
      }}
    />
  )
}
