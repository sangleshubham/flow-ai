// `<VisualView spec frame theme />` (§10, §20 W4 contract): dispatches every IR kind to its renderer
// inside the shared chrome and surface. Renderers are pure functions of (spec, frame, theme); they never
// fetch or call models (§3).
import { withDerivedVisibility } from '@illus/core'
import { Component, useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { ChartView } from './chart/ChartView.tsx'
import { Footer, Header, kindLabel, Legend, Toolbar } from './chrome.tsx'
import { evidenceIndex } from './elements.ts'
import { download, exportPng, exportSvg } from './export.ts'
import { GraphView } from './graph/GraphView.tsx'
import { layoutGraph as workerLayout } from './graph/layout-client.ts'
import { HtmlFallbackView } from './html/HtmlFallbackView.tsx'
import { MathView } from './math/MathView.tsx'
import { MermaidView } from './mermaid/MermaidView.tsx'
import { ILLUS_CSS } from './styles.ts'
import { Surface } from './surface.tsx'
import { themeVars } from './theme.ts'
import { TimelineView } from './timeline/TimelineView.tsx'
import type { VisualViewProps } from './types.ts'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

class RenderBoundary extends Component<
  { children: ReactNode; onError: (e: unknown) => void },
  { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(e: unknown) {
    this.props.onError(e)
  }
  override render() {
    return this.state.failed ? null : this.props.children
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'visual'

export function VisualView({
  spec,
  frame,
  theme,
  flags,
  templates,
  layoutGraph = workerLayout,
  onLayout,
  onEvidenceHover,
  onEvidenceClick,
  actions,
  sandboxUrl,
  className,
  chrome = 'full',
}: VisualViewProps) {
  const compact = chrome === 'compact'
  const { ir } = spec
  const shownFrame = useMemo(
    () => (frame ? withDerivedVisibility(ir, frame) : undefined),
    [ir, frame],
  )
  const [version, setVersion] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const elements = useMemo(() => evidenceIndex(ir), [ir])
  const title =
    spec.title ??
    ('title' in ir
      ? ir.title
      : ir.type === 'math'
      ? spec.mathBlock?.label ?? 'Formula'
      : ir.type === 'timeline'
      ? 'Timeline'
      : ir.type === 'html'
      ? 'Explainer'
      : kindLabel(ir))

  const onReady = useCallback(() => {
    setReady(true)
    setVersion((v) => v + 1)
  }, [])
  const onError = useCallback((e: unknown) => {
    setError(errorText(e))
    setReady(true)
  }, [])

  const body = (() => {
    switch (ir.type) {
      case 'graph':
        return (
          <GraphView
            ir={ir}
            theme={theme}
            frame={shownFrame}
            layout={spec.layout}
            layoutGraph={layoutGraph}
            onLayout={onLayout}
            onReady={onReady}
            onError={onError}
          />
        )
      case 'sequence':
      case 'state':
      case 'class':
      case 'er':
        return (
          <MermaidView
            ir={ir}
            theme={theme}
            onReady={onReady}
            onError={onError}
          />
        )
      case 'chart':
        return (
          <ChartView
            ir={ir}
            theme={theme}
            onReady={onReady}
            onError={onError}
          />
        )
      case 'math':
        return <MathView ir={ir} block={spec.mathBlock} onReady={onReady} />
      case 'timeline':
        return <TimelineView ir={ir} onReady={onReady} />
      case 'template': {
        const t = templates?.getTemplate(ir.templateId)
        if (!t)
          return (
            <Note
              onShow={onReady}
            >{`The ${ir.templateId} template is not available.`}</Note>
          )
        const parsed = t.propsSchema.safeParse(ir.props)
        if (!parsed.success)
          return (
            <Note
              onShow={onReady}
            >{`The ${ir.templateId} props did not validate.`}</Note>
          )
        return (
          <t.Component
            ir={ir}
            props={parsed.data}
            layout={t.layout(parsed.data)}
            frame={shownFrame}
            theme={theme}
            onReady={onReady}
          />
        )
      }
      case 'html':
        if (!flags?.htmlFallback)
          return (
            <Note onShow={onReady}>
              HTML explainers are turned off (htmlFallback flag).
            </Note>
          )
        return (
          <HtmlFallbackView
            ir={ir}
            {...(sandboxUrl ? { sandboxUrl } : {})}
            onReady={onReady}
          />
        )
    }
  })()

  const canExport = ready && !error && ir.type !== 'html' && ir.type !== 'math'
  const svgRoot = () =>
    viewRef.current?.querySelector('.illus-canvas svg') ?? null
  const exportAs = async (fmt: 'svg' | 'png') => {
    const svg = svgRoot()
    if (!svg) return
    if (fmt === 'svg') download(exportSvg(svg, theme), `${slug(title)}.svg`)
    else download(await exportPng(svg, theme), `${slug(title)}.png`)
  }

  return (
    <div
      ref={viewRef}
      className={`illus-view${compact ? ' illus-view-compact' : ''}${
        className ? ` ${className}` : ''
      }`}
      aria-label={compact ? title : undefined}
      role={compact ? 'figure' : undefined}
      style={themeVars(theme)}
      data-kind={ir.type}
      data-theme={theme.dark ? 'dark' : 'light'}
      data-ready={ready ? 'true' : 'false'}
      data-step={shownFrame?.step}
    >
      <style>{ILLUS_CSS}</style>
      {compact ? (
        <Toolbar
          ir={ir}
          groundingScore={spec.groundingScore}
          actions={actions}
          onExportSvg={canExport ? () => void exportAs('svg') : undefined}
          onExportPng={canExport ? () => void exportAs('png') : undefined}
        />
      ) : (
        <Header title={title} ir={ir} groundingScore={spec.groundingScore} />
      )}
      {error ? (
        <div className="illus-note" role="alert">
          Could not draw this visual: {error}
        </div>
      ) : ir.type === 'html' ? (
        body
      ) : (
        <Surface
          elements={elements}
          frame={shownFrame}
          newIds={spec.newIds}
          version={version}
          fill={compact}
          onEvidenceHover={onEvidenceHover}
          onEvidenceClick={onEvidenceClick}
        >
          <RenderBoundary onError={onError}>{body}</RenderBoundary>
        </Surface>
      )}
      {compact ? (
        spec.newIds && (
          <div className="illus-footer">
            <Legend />
          </div>
        )
      ) : (
        <Footer
          legend={!!spec.newIds}
          actions={actions}
          kind={ir.type}
          onExportSvg={canExport ? () => void exportAs('svg') : undefined}
          onExportPng={canExport ? () => void exportAs('png') : undefined}
        />
      )}
    </div>
  )
}

function Note({
  children,
  onShow,
}: {
  children: ReactNode
  onShow: () => void
}) {
  const done = useRef(false)
  if (!done.current) {
    done.current = true
    queueMicrotask(onShow)
  }
  return <div className="illus-note">{children}</div>
}
