// Public API of @illus/render. Owner: W4 (W5 owns `src/templates`, W10 owns `src/check`). Nothing else may be imported from outside this package.
export { VisualView } from './VisualView.tsx'
export type { EvidenceEvent, RenderTemplate, TemplateViewProps, VisualActions, VisualSpec, VisualViewProps } from './types.ts'

// Shared chrome pieces, for views rendered outside VisualView (e.g. W7's trace view).
export { Footer, Header } from './chrome.tsx'
export { Surface } from './surface.tsx'
export type { SurfaceProps } from './surface.tsx'
export { ILLUS_CSS, SVG_CSS } from './styles.ts'

// Theme tokens (§10).
export { readFlowTheme, resolveColour, resolveTokens, themeVars, tokensFromFlowVars, useFlowTheme, watchFlowTheme } from './theme.ts'

// Elements, evidence and frames.
export { elementFrame, evidenceIndex, frameClasses, irElements } from './elements.ts'
export type { ElementFrameState, ElementKind, IrElement } from './elements.ts'

// Graph layout (§10): worker-backed `layoutGraph`, plus the pieces W5 (graph-ds) and W8 reuse.
export { layoutGraph } from './graph/layout-client.ts'
export { ELK_LAYERED_OPTIONS, ELK_STRESS_OPTIONS, runElkLayout } from './graph/elk.ts'
export { canvasMeasure, graphLayoutInput, nodeSize, wrapLabel } from './graph/measure.ts'
export type { AddedNode, Measure } from './graph/measure.ts'

// Engine inputs compiled from IR.
export { toMermaid } from './mermaid/source.ts'
export type { MermaidIR, MermaidSource } from './mermaid/source.ts'
export { renderMermaidSvg, tagMermaid } from './mermaid/render.ts'
export { chartRows, sampleFn, toVegaLite } from './chart/vega-lite.ts'
export { markTexTerms } from './math/tex.ts'
export { layoutTimeline } from './timeline/layout.ts'
export type { TimelineLayout } from './timeline/layout.ts'

// Export (§10) and sanitisers (§17).
export { download, exportPng, exportSvg } from './export.ts'
export { sanitizeKatex, sanitizeMathMl, sanitizeSvg } from './sanitize.ts'
export { SANDBOX_MESSAGE, SANDBOX_URL } from './html/HtmlFallbackView.tsx'
