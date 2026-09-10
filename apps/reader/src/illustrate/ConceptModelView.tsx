// §13 concept-model items: drawn from the stored model (never the record's cached IR or layout), with
// W8's view toggles and evolution scrubber on W6's player (ADR 0044).
import { Player } from '@illus/anim'
import {
  conceptLayoutGraph,
  ConceptViewToggles,
  EvolutionScrubber,
  sectionView,
} from '@illus/concepts'
import type {
  ScrubberPlayerProps,
  SectionView,
  SectionViewOptions,
} from '@illus/concepts'
import type {
  ConceptModel,
  FrameState,
  LayoutGraphFn,
  LayoutGraphResult,
} from '@illus/core'
import React, { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export interface ConceptModelViewProps {
  model: ConceptModel
  sectionOrdinal: number
  sectionTitles?: Record<string, string>
  /** The renderer's layout function; wrapped with the model's stored positions as ELK hints. */
  baseLayout: LayoutGraphFn
  /** Persist the new positions (`withLayout`) so the next section keeps the mental map. */
  onLayout: (layout: LayoutGraphResult) => void
  /** Draws one view (e.g. `<VisualView spec={{ ir: view.ir, newIds: view.newIds }} … />`). */
  draw: (
    view: SectionView,
    frame: FrameState,
    layoutGraph: LayoutGraphFn,
    onLayout?: (layout: LayoutGraphResult) => void,
  ) => ReactNode
  playerProps?: Omit<ScrubberPlayerProps, 'frames' | 'renderFrame'>
}

export function ConceptModelView({
  model,
  sectionOrdinal,
  sectionTitles,
  baseLayout,
  onLayout,
  draw,
  playerProps,
}: ConceptModelViewProps) {
  const [toggles, setToggles] = useState<
    Pick<SectionViewOptions, 'onlyNew' | 'fullModel'>
  >({})
  const [evolve, setEvolve] = useState(false)
  const view = useMemo(
    () => sectionView(model, sectionOrdinal, toggles),
    [model, sectionOrdinal, toggles],
  )
  // Stable per model so the renderer does not relayout on every pane re-render.
  const layoutGraph = useMemo(
    () => conceptLayoutGraph(model, baseLayout),
    [model, baseLayout],
  )
  return (
    <div
      className="illus-concept-model"
      data-concept-model={model.conceptModelId}
    >
      <ConceptViewToggles value={toggles} onChange={setToggles} />
      {view.focus && (
        <p role="status">
          Focus mode: nodes far from this section are collapsed. Turn on “Show
          full model” to see everything.
        </p>
      )}
      {/* A subset layout ("only this section's additions") must not overwrite the full model's positions. */}
      {draw(
        view,
        view.frame,
        layoutGraph,
        toggles.onlyNew ? undefined : onLayout,
      )}
      <details
        onToggle={(e) =>
          setEvolve((e.currentTarget as HTMLDetailsElement).open)
        }
      >
        <summary>How this model grew</summary>
        {evolve && (
          <EvolutionScrubber
            Player={Player}
            model={model}
            sectionOrdinal={sectionOrdinal}
            viewOptions={toggles}
            {...(sectionTitles && { sectionTitles })}
            {...playerProps}
            renderView={(v, frame) => draw(v, frame, layoutGraph)}
          />
        )}
      </details>
    </div>
  )
}
