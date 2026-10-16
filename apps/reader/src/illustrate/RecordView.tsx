import { Player, PlaybackControls, ScenePlayer } from '@illus/anim'
import { conceptModelIdOf, sectionView } from '@illus/concepts'
import type { SectionView } from '@illus/concepts'
import { buildFrames, IR } from '@illus/core'
import type {
  Block,
  ConceptModel,
  FrameState,
  GraphIR,
  LayoutGraphFn,
  LayoutGraphResult,
  ThemeTokens,
  TraceRecord,
  VisualKind,
  VisualRecord,
} from '@illus/core'
import {
  VisualView,
  irElements,
  layoutGraph as defaultLayout,
  readFlowTheme,
  templateRegistry,
  watchFlowTheme,
} from '@illus/render'
import type { EvidenceEvent } from '@illus/render'
import { TraceView } from '@illus/tracer'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { ConceptModelView } from './ConceptModelView'
import {
  activeSections,
  enabledKinds,
  getRepos,
  highlightEvidence,
  parsedVisual,
  requestVisual,
  saveConceptLayout,
  savePreferences,
  updateRecord,
} from './runtime'
import { pane } from './state'

export function RecordView({ record }: { record: VisualRecord }) {
  return record.kind === 'trace' ? (
    <ExecutedTraceView record={record} />
  ) : (
    <StaticRecordView record={record} />
  )
}

function ExecutedTraceView({ record }: { record: VisualRecord }) {
  const [trace, setTrace] = useState<TraceRecord | undefined>()
  const [code, setCode] = useState<Block | undefined>()
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  useEffect(() => {
    let current = true
    void getRepos()
      .then(async (repos) => {
        const t = record.traceKey
          ? await repos.traces.get(record.traceKey)
          : undefined
        const b = t ? await repos.blocks.get(t.codeBlockId) : undefined
        if (current) {
          setTrace(t)
          setCode(b)
          if (!t) setError('This saved trace is unavailable. Regenerate it.')
        }
      })
      .catch((e) => {
        if (current) setError(e.message)
      })
    return () => {
      current = false
    }
  }, [record.traceKey])
  if (!pane.preferences.flags.tracer)
    return (
      <p>
        Enable executed code traces in Illustration settings to view this trace.
      </p>
    )
  if (error) return <p role="alert">{error}</p>
  if (!trace) return <p aria-busy="true">Loading saved trace…</p>
  return (
    <div>
      <TraceView
        record={trace}
        originalCode={code?.code?.source ?? code?.text ?? ''}
        langHint={code?.code?.langHint}
        flags={pane.preferences.flags}
        controls={PlaybackControls}
        onStep={(step) => {
          pane.announcement = `Line ${step.pyLine}: ${step.event}`
        }}
      />
      <button onClick={() => requestVisual({ planItemId: record.planItemId })}>
        Regenerate trace
      </button>
      <button
        onClick={() => {
          void updateRecord({ ...record, feedback: { vote: 'up' } })
        }}
      >
        Helpful
      </button>
      <button onClick={() => setFeedbackOpen(true)}>Not helpful</button>
      {feedbackOpen && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void updateRecord({
              ...record,
              feedback: {
                vote: 'down',
                ...(note.trim() ? { note: note.trim() } : {}),
              },
            })
            setFeedbackOpen(false)
          }}
        >
          <label>
            What should improve? (optional)
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={300}
            />
          </label>
          <button type="submit">Send feedback</button>
          <button type="button" onClick={() => setFeedbackOpen(false)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  )
}

// Module-level so its identity is stable: the Player re-runs (and first clears) its highlight effect
// whenever this callback changes, which would otherwise happen on every pane re-render.
const highlightStepEvidence = (evidence: EvidenceEvent['evidence'] | null) => {
  void highlightEvidence(
    evidence ? { irId: 'step', target: 'step', label: 'Step', evidence } : null,
    false,
    'step',
  )
}

// The scene player's own handlers, module-level for the same reason as `highlightStepEvidence`: stable identities.
const clickStepEvidence = (evidence: EvidenceEvent['evidence']) => {
  void highlightEvidence(
    { irId: 'step', target: 'step', label: 'Step', evidence },
    true,
    'step',
  )
}
const rememberHighlightSteps = (on: boolean) => {
  void savePreferences({ ...pane.preferences, highlightSteps: on })
}

/**
 * The graph scene player (ADR 0050), mounted behind the `sceneAnimations` flag. ScenePlayer renders the
 * scene once per `renderScene` identity and rebuilds its timeline when `ir` or `frames` change, so all
 * three must be stable across the pane's re-renders. `renderFrame` is a fresh closure every render, so
 * `sceneInputs` lists what it reads that can really change (the record, theme, expanded state, flags): the
 * scene is drawn again exactly when one does, and with the closure of that render.
 */
function GraphScene({
  ir,
  frames,
  renderFrame,
  sceneInputs,
}: {
  ir: GraphIR
  frames: readonly FrameState[]
  renderFrame: (frame?: FrameState) => ReactNode
  sceneInputs: readonly unknown[]
}) {
  // No frame: the complete, static visual that the scene timeline then animates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const renderScene = useMemo(() => () => renderFrame(), sceneInputs)
  const onStepChange = useCallback(
    (index: number) => {
      pane.announcement = frames[index]?.narration ?? ''
    },
    [frames],
  )
  return (
    <ScenePlayer
      ir={ir}
      frames={frames}
      renderScene={renderScene}
      autoPlay
      highlightWhilePlaying={pane.preferences.highlightSteps}
      onHighlightWhilePlayingChange={rememberHighlightSteps}
      defaultSpeed={pane.preferences.speed}
      reducedMotion={
        pane.preferences.reducedMotion === 'system'
          ? undefined
          : pane.preferences.reducedMotion === 'on'
      }
      onStepChange={onStepChange}
      onEvidenceClick={clickStepEvidence}
      onEvidenceHighlight={highlightStepEvidence}
    />
  )
}

function StaticRecordView({ record }: { record: VisualRecord }) {
  const [theme, setTheme] = useState<ThemeTokens>(() => readFlowTheme())
  const [instruction, setInstruction] = useState('')
  const [regenerate, setRegenerate] = useState(false)
  const [note, setNote] = useState('')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [wrong, setWrong] = useState<{
    irId: string
    evidence?: EvidenceEvent['evidence']
  } | null>(null)
  const [mathBlock, setMathBlock] = useState<Block | undefined>()
  const [expanded, setExpanded] = useState(false)
  const [reporting, setReporting] = useState(false)
  const animationJson = record.animation ? JSON.stringify(record.animation) : ''
  const irJson = JSON.stringify(record.ir)
  // Renderers redraw when the IR identity changes; a fresh parse on every pane re-render would
  // replace the diagram DOM and drop keyboard focus from the element the reader is on.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const parsed = useMemo(() => parsedVisual(record), [irJson])
  const frames = useMemo(() => {
    if (!animationJson) return []
    try {
      return buildFrames(
        IR.parse(JSON.parse(irJson)),
        JSON.parse(animationJson),
        { templates: templateRegistry },
      )
    } catch {
      return []
    }
  }, [irJson, animationJson])
  const sourceBlockId =
    parsed.success && parsed.data.type === 'math'
      ? parsed.data.sourceBlockId
      : undefined
  // §13 (ADR 0044): concept-model items are drawn from the stored model, behind the `conceptModels` flag.
  const item = pane.items.find((i) => i.planItemId === record.planItemId)
  const conceptModelId =
    pane.preferences.flags.conceptModels && item
      ? conceptModelIdOf(item)
      : undefined
  const sections = activeSections()
  const section = sections.find((x) => x.sectionId === record.sectionId)
  const [model, setModel] = useState<ConceptModel | null | undefined>()
  useEffect(() => {
    setModel(undefined)
    if (!conceptModelId) return
    let live = true
    void getRepos()
      .then((r) => r.conceptModels.get(conceptModelId))
      .then(
        (m) => {
          if (live) setModel(m ?? null)
        },
        () => {
          if (live) setModel(null)
        },
      )
    return () => {
      live = false
    }
  }, [conceptModelId])
  const sectionTitles = useMemo(
    () => Object.fromEntries(sections.map((x) => [x.sectionId, x.title])),
    [sections],
  )
  const conceptIr = useMemo(
    () =>
      model && section
        ? sectionView(model, section.ordinal, { fullModel: true }).ir
        : undefined,
    [model, section],
  )
  useEffect(() => watchFlowTheme(setTheme, document.documentElement), [])
  useEffect(() => {
    setRegenerate(false)
    setWrong(null)
    setFeedbackOpen(false)
    setReporting(false)
    setNote('')
    if (sourceBlockId) {
      void getRepos()
        .then((r) => r.blocks.get(sourceBlockId))
        .then(setMathBlock)
    }
  }, [record.cacheKey, sourceBlockId])
  if (!parsed.success)
    return (
      <p role="alert">
        This saved visual cannot be displayed. Regenerate it to update its
        format.
      </p>
    )
  const ir = parsed.data
  // Saving a preference replaces the flags object even when no flag changed; compare by value instead.
  const flagsKey = JSON.stringify(pane.preferences.flags)
  // Element feedback names what the reader sees: the model's view for concept items.
  const shownIr = conceptIr ?? ir
  const vote = async (value: 'up' | 'down') => {
    await updateRecord({ ...record, feedback: { vote: value } })
    setFeedbackOpen(value === 'down')
    pane.announcement = 'Feedback saved.'
  }
  const simulated = record.validation.issues.find(
    (issue) => issue.code === 'trace-simulated',
  )
  const renderFrame = (frame?: FrameState) => (
    <VisualView
      spec={{
        ir,
        groundingScore: record.validation.groundingScore,
        layout: record.layout as any,
        mathBlock,
      }}
      chrome="compact"
      frame={frame}
      theme={theme}
      flags={pane.preferences.flags}
      templates={
        pane.preferences.flags.templates ? templateRegistry : undefined
      }
      onEvidenceHover={(event) => {
        void highlightEvidence(event)
      }}
      onEvidenceClick={(event) => {
        void highlightEvidence(event, true)
      }}
      onLayout={(layout) => {
        if (!record.layout) void updateRecord({ ...record, layout })
      }}
      actions={actions}
    />
  )
  const actions = {
    onRegenerate: () => setRegenerate(true),
    onKindOverride: (kind: VisualKind) =>
      requestVisual({ kindOverride: kind, planItemId: record.planItemId }),
    kinds: enabledKinds(),
    onVote: (value: 'up' | 'down') => {
      void vote(value)
    },
    vote: record.feedback?.vote,
    onExpand: () => setExpanded((open) => !open),
    expanded,
    menuExtra: (
      <>
        <button
          type="button"
          className="illus-menu-item"
          role="menuitem"
          onClick={() => setReporting(true)}
        >
          Report a wrong element…
        </button>
        <p
          className="illus-menu-note"
          title="Input and output tokens for this illustration"
        >
          {record.usageTokens.toLocaleString()} tokens
        </p>
      </>
    ),
  }
  const drawConcept = (
    view: SectionView,
    frame: FrameState,
    layoutGraph: LayoutGraphFn,
    onLayout?: (layout: LayoutGraphResult) => void,
  ) => (
    <VisualView
      spec={{
        ir: view.ir,
        newIds: view.newIds,
        groundingScore: record.validation.groundingScore,
      }}
      chrome="compact"
      frame={frame}
      theme={theme}
      flags={pane.preferences.flags}
      layoutGraph={layoutGraph}
      {...(onLayout && { onLayout })}
      onEvidenceHover={(event) => {
        void highlightEvidence(event)
      }}
      onEvidenceClick={(event) => {
        void highlightEvidence(event, true)
      }}
      actions={actions}
    />
  )
  const body =
    conceptModelId && model === undefined ? (
      <p aria-busy="true">Loading concept model…</p>
    ) : model && section ? (
      <ConceptModelView
        model={model}
        sectionOrdinal={section.ordinal}
        sectionTitles={sectionTitles}
        baseLayout={defaultLayout}
        onLayout={(layout) => {
          void saveConceptLayout(model.conceptModelId, layout)
        }}
        draw={drawConcept}
        playerProps={{
          defaultSpeed: pane.preferences.speed,
          ...(pane.preferences.reducedMotion !== 'system' && {
            reducedMotion: pane.preferences.reducedMotion === 'on',
          }),
          onEvidenceClick: (evidence) => {
            void highlightEvidence(
              { irId: 'step', target: 'step', label: 'Step', evidence },
              true,
              'step',
            )
          },
          onEvidenceHighlight: highlightStepEvidence,
        }}
      />
    ) : pane.preferences.flags.animations &&
      pane.preferences.flags.sceneAnimations &&
      ir.type === 'graph' &&
      frames.length > 1 ? (
      <GraphScene
        ir={ir}
        frames={frames}
        renderFrame={renderFrame}
        sceneInputs={[record, theme, expanded, flagsKey, mathBlock]}
      />
    ) : pane.preferences.flags.animations && frames.length ? (
      <Player
        frames={frames}
        renderFrame={renderFrame}
        autoPlay
        highlightWhilePlaying={pane.preferences.highlightSteps}
        onHighlightWhilePlayingChange={(on) =>
          void savePreferences({ ...pane.preferences, highlightSteps: on })
        }
        defaultSpeed={pane.preferences.speed}
        reducedMotion={
          pane.preferences.reducedMotion === 'system'
            ? undefined
            : pane.preferences.reducedMotion === 'on'
        }
        onStepChange={(index) => {
          pane.announcement = frames[index]?.narration ?? ''
        }}
        onEvidenceClick={(evidence) => {
          void highlightEvidence(
            { irId: 'step', target: 'step', label: 'Step', evidence },
            true,
            'step',
          )
        }}
        onEvidenceHighlight={highlightStepEvidence}
      />
    ) : (
      renderFrame()
    )
  return (
    <>
      {expanded && (
        <div
          className="illus-backdrop"
          aria-hidden="true"
          onClick={() => setExpanded(false)}
        />
      )}
      <div
        className="illus-record"
        data-expanded={expanded || undefined}
        role={expanded ? 'dialog' : undefined}
        aria-modal={expanded || undefined}
        aria-label={expanded ? item?.intent ?? 'Illustration' : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && expanded) {
            // Close the large view only; the pane's own Escape handler checks defaultPrevented.
            e.preventDefault()
            setExpanded(false)
          }
        }}
        onContextMenu={(e) => {
          const element = (e.target as Element).closest('[data-ir-id]')
          if (!element) return
          e.preventDefault()
          const id = element.getAttribute('data-ir-id')!
          setWrong({
            irId: id,
            evidence: irElements(shownIr).find((el) => el.id === id)?.evidence,
          })
          setNote('')
        }}
      >
        {record.stale && (
          <p role="status">
            This saved illustration is from an earlier version. Regenerate to
            update it.
          </p>
        )}
        {simulated && (
          <p role="status">Simulated illustration: {simulated.message}</p>
        )}
        {body}
        {regenerate && (
          <form
            className="illus-inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              requestVisual({ instruction, planItemId: record.planItemId })
              setRegenerate(false)
            }}
          >
            <label>
              Instruction{' '}
              <textarea
                maxLength={300}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
            </label>
            <small>{instruction.length}/300</small>
            <button type="submit">Regenerate with instruction</button>
            <button type="button" onClick={() => setRegenerate(false)}>
              Cancel
            </button>
          </form>
        )}
        {feedbackOpen && (
          <form
            className="illus-inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              void updateRecord({
                ...record,
                feedback: { vote: 'down', note },
              }).then(() => {
                setFeedbackOpen(false)
                pane.announcement = 'Feedback saved.'
              })
            }}
          >
            <label>
              Feedback note (optional)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button>Save feedback</button>
          </form>
        )}
        {reporting && !wrong && (
          <div
            className="illus-inline-form"
            role="group"
            aria-label="Element feedback"
          >
            <h3>Which element is wrong?</h3>
            <p className="illus-hint">
              Tip: right-click an element in the diagram to report it directly.
            </p>
            <div className="illus-element-list">
              {irElements(shownIr).map((el) => (
                <button
                  key={el.id}
                  onClick={() => {
                    setWrong({ irId: el.id, evidence: el.evidence })
                    setNote('')
                    setReporting(false)
                  }}
                >
                  {el.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setReporting(false)}>
              Cancel
            </button>
          </div>
        )}
        {wrong && (
          <form
            className="illus-inline-form"
            aria-label="Element report"
            onSubmit={(e) => {
              e.preventDefault()
              void updateRecord({
                ...record,
                elementReports: [
                  ...(record.elementReports ?? []),
                  {
                    elementId: wrong.irId,
                    evidence: wrong.evidence,
                    note,
                    createdAt: Date.now(),
                  },
                ],
              }).then(() => {
                setWrong(null)
                pane.announcement = 'Element report saved.'
              })
            }}
          >
            <h3>This is wrong</h3>
            <p>{wrong.evidence?.quote}</p>
            <label>
              What should change?
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required
              />
            </label>
            <button>Save report</button>
            <button type="button" onClick={() => setWrong(null)}>
              Cancel
            </button>
          </form>
        )}
      </div>
    </>
  )
}
