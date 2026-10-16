import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { buildFrames, compileSceneTimeline, emptyFrame } from '@illus/core'
import type { AnimationIR, FrameState, GraphIR } from '@illus/core'
import { make } from '@illus/core/testing'
import { VisualView, templateRegistry } from '@illus/render'
import {
  ScenePlayer,
  buildSceneTimeline,
  readSceneGeometry,
} from '../../src/index.ts'
import { evidence, hiddenGraphAnimation, hiddenGraphIR } from '../golden.ts'

declare global {
  interface Window {
    /** Harness only: lets the e2e tests seek the timeline and read the compiled plan. */
    __scene?: ReturnType<typeof buildSceneTimeline> & {
      plan: ReturnType<typeof compileSceneTimeline>
      /** The camera group's markup as React rendered it, before the timeline touched anything. */
      staticMarkup: string
    }
    /** Harness only: the ScenePlayer's master timeline, found among GSAP's top-level children. */
    __sceneTimeline?: () => gsap.core.Timeline | undefined
    /** Harness only: how many playhead tweens are running on that timeline. */
    __sceneRunning?: () => number
    /** Harness only: what the ScenePlayer reported to its host. */
    __sceneLog?: { highlights: (string | null)[]; clicks: string[] }
  }
}

if (hiddenGraphIR.type !== 'graph') throw new Error('Expected a graph fixture')
/** The B2 hidden-reveal chain a → b → c, with edge labels so that drawing has ornaments to wait for. */
const chain: GraphIR = {
  ...hiddenGraphIR,
  edges: hiddenGraphIR.edges.map((edge) => ({ ...edge, label: edge.id })),
}
/**
 * The chain is one node tall, so no camera could zoom into it. Two more children of `a`, revealed with
 * `c`, give the layout a second dimension: the first step zooms in and the last step shows everything.
 */
export const spread: GraphIR = {
  ...chain,
  nodes: [
    ...chain.nodes,
    { id: 'd', label: 'D', shape: 'box', evidence },
    { id: 'e', label: 'E', shape: 'box', evidence },
  ],
  edges: [
    ...chain.edges,
    { id: 'ad', from: 'a', to: 'd', style: 'solid', evidence },
    { id: 'ae', from: 'a', to: 'e', style: 'solid', evidence },
  ],
}
export const spreadAnimation: AnimationIR = {
  ...hiddenGraphAnimation,
  initialHidden: ['node:b', 'node:c', 'node:d', 'node:e'],
  steps: [
    hiddenGraphAnimation.steps[0]!,
    {
      id: 'rest',
      narration: 'Show the rest.',
      evidence,
      actions: ['c', 'd', 'e'].map((id) => ({
        op: 'reveal' as const,
        target: `node:${id}` as const,
      })),
    },
  ],
}

/** Hand-made frames for the chain: tones, annotations, a token, then faded, hidden and shown again. */
function detailFrames(): FrameState[] {
  const base = buildFrames(chain, hiddenGraphAnimation)
  return [
    base[0]!,
    {
      ...base[1]!,
      highlights: { 'node:b': 'focus' },
      annotations: { 'node:b': 'first' },
    },
    {
      ...base[2]!,
      highlights: { 'node:b': 'success' },
      annotations: { 'node:b': 'second' },
      tokens: [{ id: 'travel', label: 'T', path: ['ab', 'bc'] }],
    },
    { ...emptyFrame(), step: 3, removed: ['node:b'] },
    { ...emptyFrame(['node:b']), step: 4, removed: ['node:b'] },
    { ...emptyFrame(), step: 5 },
    // faded, then straight back to full: the reveal starts from the faded opacity
    { ...emptyFrame(), step: 6, removed: ['node:b'] },
    { ...emptyFrame(), step: 7 },
  ]
}

/** The chain with a muted tone: s0 shows `a`, s1 reveals `b` and mutes `a`, s2 unmutes `a` and reveals `c`. */
function mutedFrames(): FrameState[] {
  const base = buildFrames(chain, hiddenGraphAnimation)
  return [
    base[0]!,
    { ...base[1]!, highlights: { 'node:a': 'muted' } },
    base[2]!,
  ]
}

export function SceneHarness({
  variant,
}: {
  variant: 'spread' | 'details' | 'muted'
}) {
  const root = useRef<HTMLDivElement>(null)
  const details = variant !== 'spread'
  const graph = details ? chain : spread
  useEffect(() => {
    const frames =
      variant === 'details'
        ? detailFrames()
        : variant === 'muted'
        ? mutedFrames()
        : buildFrames(spread, spreadAnimation)
    let built: ReturnType<typeof buildSceneTimeline> | undefined
    const build = () => {
      if (built) return
      const svg = root.current?.querySelector<SVGSVGElement>(
        '.illus-view[data-ready="true"] svg[data-layout]',
      )
      const geometry = svg && readSceneGeometry(svg)
      if (!svg || !geometry) return
      const plan = compileSceneTimeline(
        graph,
        frames,
        geometry.boxes,
        geometry.full,
      )
      const staticMarkup = svg.querySelector('[data-camera]')!.innerHTML
      built = buildSceneTimeline(svg, plan)
      window.__scene = { ...built, plan, staticMarkup }
    }
    const observer = new MutationObserver(build)
    observer.observe(root.current!, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-ready', 'data-layout'],
    })
    build()
    return () => {
      observer.disconnect()
      built?.ctx.revert()
      delete window.__scene
    }
  }, [variant, details, graph])
  return (
    <div ref={root}>
      <VisualView
        spec={{ ir: graph }}
        theme={make.themeTokens()}
        templates={templateRegistry}
      />
    </div>
  )
}

/** The scene player on the spread graph: s0 shows `a`, s1 adds `b`, s2 adds `c`, `d` and `e`. */
export function ScenePlayerHarness({
  reducedMotion,
  autoPlay,
  swap,
}: {
  reducedMotion: boolean | undefined
  autoPlay: boolean
  /** Adds a button that hands the player a new (equal) frames array. */
  swap: boolean
}) {
  const [frames, setFrames] = useState(() =>
    buildFrames(spread, spreadAnimation),
  )
  const renderScene = useCallback(
    () => (
      <VisualView
        spec={{ ir: spread }}
        theme={make.themeTokens()}
        templates={templateRegistry}
      />
    ),
    [],
  )
  const log = useMemo(() => {
    const entries = {
      highlights: [] as (string | null)[],
      clicks: [] as string[],
    }
    window.__sceneLog = entries
    const timeline = () =>
      gsap.globalTimeline
        .getChildren(false, false, true)
        .find(
          (child): child is gsap.core.Timeline =>
            'labels' in child && 's1' in child.labels,
        )
    window.__sceneTimeline = timeline
    window.__sceneRunning = () => {
      const tl = timeline()
      return tl ? gsap.getTweensOf(tl, true).length : 0
    }
    return entries
  }, [])
  const onEvidenceHighlight = useCallback(
    (e: { quote: string } | null) => log.highlights.push(e?.quote ?? null),
    [log],
  )
  const onEvidenceClick = useCallback(
    (e: { quote: string }) => log.clicks.push(e.quote),
    [log],
  )
  const onStepChange = useCallback(
    (index: number) =>
      document.documentElement.setAttribute('data-step', String(index)),
    [],
  )
  return (
    <>
      <ScenePlayer
        ir={spread}
        frames={frames}
        renderScene={renderScene}
        reducedMotion={reducedMotion}
        autoPlay={autoPlay}
        onEvidenceHighlight={onEvidenceHighlight}
        onEvidenceClick={onEvidenceClick}
        onStepChange={onStepChange}
      />
      {swap && (
        <button
          type="button"
          onClick={() => setFrames(buildFrames(spread, spreadAnimation))}
        >
          Swap frames
        </button>
      )}
    </>
  )
}
