// `<EvolutionScrubber />` (§13): replays how a concept model was built, one frame per patch boundary,
// with W6's §11 player. `<ConceptViewToggles />`: the two view toggles. Written without JSX and with the
// player passed in, so DOM-free importers of @illus/concepts (the pipeline) never load React components.
import { createElement as h, useMemo } from 'react'
import type { ComponentType, ReactNode } from 'react'

import { emptyFrame } from '@illus/core'
import type { ConceptModel, Evidence, FrameState } from '@illus/core'

import { opEvidence } from './apply.ts'
import { sectionView } from './view.ts'
import type { SectionView, SectionViewOptions } from './view.ts'

/** One frame per non-stale patch up to `sectionOrdinal`; frame i shows the model as patch i left it. */
export function evolutionFrames(
  model: ConceptModel,
  sectionOrdinal: number,
  opts: SectionViewOptions & { sectionTitles?: Record<string, string> } = {},
): { frames: FrameState[]; views: SectionView[] } {
  const frames: FrameState[] = []
  const views: SectionView[] = []
  for (const p of model.patches) {
    if (p.sectionOrdinal > sectionOrdinal || p.stale || !p.ops.length) continue
    const view = sectionView(model, p.sectionOrdinal, opts)
    const counts = (
      [
        ['added', view.patch?.added.length],
        ['updated', view.patch?.updated.length],
        ['removed', view.patch?.removed.length],
      ] as const
    )
      .filter(([, n]) => n)
      .map(([what, n]) => `${n} ${what}`)
      .join(', ')
    const title = opts.sectionTitles?.[p.sectionId] ?? `Section ${frames.length + 1}`
    frames.push({
      ...emptyFrame(),
      ...view.frame,
      step: frames.length,
      stepId: p.patchId,
      narration: `${title}: ${counts || 'no changes'}`.slice(0, 140),
      evidence: opEvidence(p.ops[0]!),
    })
    views.push(view)
  }
  return { frames, views }
}

/** The props of W6's `Player` (`@illus/anim`) that the scrubber uses, structurally. */
export interface ScrubberPlayerProps {
  frames: readonly FrameState[]
  renderFrame: (frame: FrameState) => ReactNode
  onStepChange?: (index: number) => void
  onEvidenceClick?: (evidence: Evidence) => void
  onEvidenceHighlight?: (evidence: Evidence | null) => void
  defaultSpeed?: number
  reducedMotion?: boolean
}

export interface EvolutionScrubberProps extends Omit<ScrubberPlayerProps, 'frames' | 'renderFrame'> {
  /** W6's `Player` from `@illus/anim`. */
  Player: ComponentType<ScrubberPlayerProps>
  model: ConceptModel
  /** The reader's section: frames stop at its patch. */
  sectionOrdinal: number
  /** Section titles for the narration ("6.2 Log Replication: 3 added"). */
  sectionTitles?: Record<string, string>
  viewOptions?: SectionViewOptions
  /** Draws one view, e.g. `<VisualView spec={{ ir: view.ir, newIds: view.newIds }} frame={frame} … />`. */
  renderView: (view: SectionView, frame: FrameState) => ReactNode
}

export function EvolutionScrubber({ Player, model, sectionOrdinal, sectionTitles, viewOptions, renderView, ...player }: EvolutionScrubberProps) {
  const { frames, views } = useMemo(
    () => evolutionFrames(model, sectionOrdinal, { ...viewOptions, ...(sectionTitles && { sectionTitles }) }),
    [model, sectionOrdinal, sectionTitles, viewOptions],
  )
  if (!frames.length) return null
  return h(Player, { ...player, frames, renderFrame: (frame: FrameState) => renderView(views[frame.step]!, frame) })
}

export interface ConceptViewTogglesProps {
  value: Pick<SectionViewOptions, 'onlyNew' | 'fullModel'>
  onChange: (value: Pick<SectionViewOptions, 'onlyNew' | 'fullModel'>) => void
}

/** "Only this section's additions" and "Show full model" (§13). */
export function ConceptViewToggles({ value, onChange }: ConceptViewTogglesProps) {
  const box = (key: 'onlyNew' | 'fullModel', label: string) =>
    h(
      'label',
      null,
      h('input', { type: 'checkbox', checked: !!value[key], onChange: (e: { target: { checked: boolean } }) => onChange({ ...value, [key]: e.target.checked }) }),
      label,
    )
  return h(
    'div',
    { className: 'illus-concept-toggles', role: 'group', 'aria-label': 'Concept model view' },
    box('onlyNew', "Only this section's additions"),
    box('fullModel', 'Show full model'),
  )
}
