import { useEffect, useRef } from 'react'
import { buildFrames, compileSceneTimeline, emptyFrame } from '@illus/core'
import type { AnimationIR, FrameState, GraphIR } from '@illus/core'
import { make } from '@illus/core/testing'
import { VisualView, templateRegistry } from '@illus/render'
import { buildSceneTimeline, readSceneGeometry } from '../../src/index.ts'
import { evidence, hiddenGraphAnimation, hiddenGraphIR } from '../golden.ts'

declare global {
  interface Window {
    /** Harness only: lets the e2e tests seek the timeline and read the compiled plan. */
    __scene?: ReturnType<typeof buildSceneTimeline> & {
      plan: ReturnType<typeof compileSceneTimeline>
      /** The camera group's markup as React rendered it, before the timeline touched anything. */
      staticMarkup: string
    }
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
const spread: GraphIR = {
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
const spreadAnimation: AnimationIR = {
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

export function SceneHarness({ details }: { details: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const graph = details ? chain : spread
  useEffect(() => {
    const frames = details
      ? detailFrames()
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
  }, [details, graph])
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
