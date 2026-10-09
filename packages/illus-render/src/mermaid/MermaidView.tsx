// Mermaid renderer for sequence, state, class and ER visuals (§10). Frames are applied by the shared
// surface through classes on the tagged elements, so sequence animations step message by message.
import { useEffect, useRef } from 'react'

import type { ThemeTokens } from '@illus/core'

import { renderMermaidSvg, tagMermaid } from './render.ts'
import type { MermaidIR } from './source.ts'

export interface MermaidViewProps {
  ir: MermaidIR
  theme: ThemeTokens
  onReady: () => void
  onError: (e: unknown) => void
}

export function MermaidView({ ir, theme, onReady, onError }: MermaidViewProps) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    renderMermaidSvg(ir, theme).then(
      (svg) => {
        if (!live || !host.current) return
        // Sanitised by DOMPurify (SVG profile) in renderMermaidSvg.
        host.current.innerHTML = svg
        tagMermaid(host.current, ir)
        onReady()
      },
      (e) => live && onError(e),
    )
    return () => {
      live = false
    }
  }, [ir, theme])
  return <div ref={host} className="illus-mermaid" />
}
