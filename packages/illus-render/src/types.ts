// Public types of @illus/render (§10, §20 W4 contract).
import type { ComponentType, ReactNode } from 'react'

import type {
  Block,
  Evidence,
  Flags,
  FrameState,
  IR,
  LayoutGraphFn,
  LayoutGraphResult,
  TemplateIR,
  TemplateRegistry,
  TemplateSpec,
  ThemeTokens,
  VisualKind,
} from '@illus/core'

/**
 * What `<VisualView>` draws: the validated IR plus what the chrome needs. Renderers derive their own
 * engine input (ELK graph, Mermaid source, Vega-Lite spec) from the IR (ADR 0006).
 */
export interface VisualSpec {
  ir: IR
  /** Header title; defaults to the IR's title, or the kind. */
  title?: string
  /** `ValidationReport.groundingScore` (0–1), shown as "92% grounded". */
  groundingScore?: number
  /** `data-ir-id`s added in this section (concept models, §13). Enables the new/earlier legend. */
  newIds?: readonly string[]
  /** The book block holding the formula, for `math` (the formula never comes from the model). */
  mathBlock?: Block
  /** Cached graph layout (`VisualRecord.layout`), so revisits skip ELK (§10). */
  layout?: LayoutGraphResult
}

/** An element the reader hovered or clicked, with its verbatim evidence (§10, §14). */
export interface EvidenceEvent {
  irId: string
  /** §11 target string, e.g. `node:leader`. */
  target: string
  label: string
  evidence: Evidence
}

/** Footer actions; a button appears only when its callback is given (§10). */
export interface VisualActions {
  onRegenerate?: () => void
  onKindOverride?: (kind: VisualKind) => void
  /** Kinds offered by the override menu; defaults to every kind. */
  kinds?: readonly VisualKind[]
  onVote?: (vote: 'up' | 'down') => void
  vote?: 'up' | 'down'
  onShowEvidence?: () => void
  /** Compact chrome: open the visual large (the host owns the overlay). */
  onExpand?: () => void
  expanded?: boolean
  /** Compact chrome: host items appended to the "More actions" menu. */
  menuExtra?: ReactNode
}

/** Props of a template's React component (W5 implements; §10 template library). */
export interface TemplateViewProps<P = unknown, L = unknown> {
  ir: TemplateIR
  props: P
  layout: L
  frame?: FrameState
  theme: ThemeTokens
  /** Call once, from an effect, when the template has drawn (render checks and visual tests wait for it). */
  onReady?: () => void
}

/**
 * A template as the render package consumes it: the DOM-free `TemplateSpec` plus layout and component.
 * The component draws every element with `data-ir-id` and `data-target`, and handles the whole
 * FrameState itself (mark its root `data-illus-frame="self"` so the shared frame decoration skips it).
 */
export interface RenderTemplate<P = unknown, L = unknown> extends TemplateSpec<P> {
  layout(props: P): L
  Component: ComponentType<TemplateViewProps<P, L>>
}

export interface VisualViewProps {
  spec: VisualSpec
  /** Current animation frame (§11); omitted for static visuals. */
  frame?: FrameState
  theme: ThemeTokens
  /** Feature flags; `htmlFallback` gates the sandboxed HTML renderer. */
  flags?: Partial<Flags>
  /** W5's template registry, for `template` visuals. */
  templates?: TemplateRegistry<RenderTemplate>
  /** Layout function; defaults to the worker-backed `layoutGraph`. W8 passes its interactive variant. */
  layoutGraph?: LayoutGraphFn
  /** Called with each new graph layout so the caller can cache it on the visual record. */
  onLayout?: (layout: LayoutGraphResult) => void
  onEvidenceHover?: (e: EvidenceEvent | null) => void
  onEvidenceClick?: (e: EvidenceEvent) => void
  actions?: VisualActions
  /** URL of the sandbox page (default `/illus-sandbox.html`). */
  sandboxUrl?: string
  className?: string
  /**
   * `full` (default): title, badges and an action footer around a width-fitted diagram.
   * `compact` (ADR 0048): the diagram fills its parent's height; actions sit in a small overlay
   * toolbar and a "More actions" menu. The host shows the title.
   */
  chrome?: 'full' | 'compact'
}
