import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useReducedMotion } from 'motion/react'
import { compileSceneTimeline } from '@illus/core'
import type { FrameState, GraphIR, SceneTimeline } from '@illus/core'
import type { PlayerProps } from './Player.tsx'
import {
  HighlightToggle,
  Narration,
  useHighlightOption,
  useStepHighlight,
} from './highlight.tsx'
import { buildSceneTimeline, readSceneGeometry } from './scene-timeline.ts'
import { PlaybackControls, playbackKey, usePlayback } from './transport.tsx'

export interface ScenePlayerProps extends Omit<PlayerProps, 'renderFrame'> {
  /** The graph being animated; `frames` are `buildFrames(ir, animation)` for it. Memoise it. */
  ir: GraphIR
  /** Renders the static, complete visual once (VisualView with no frame). Memoise it: a new function re-renders the scene. */
  renderScene: () => ReactNode
}

/** A laid-out graph: the SVG GraphView finished, and a fingerprint of its geometry. */
interface Located {
  svg: SVGSVGElement
  key: string
}
type Built = ReturnType<typeof buildSceneTimeline> & {
  plan: SceneTimeline
  frames: readonly FrameState[]
  ir: GraphIR
}

const LAID_OUT_SVG = '.illus-view[data-ready="true"] svg[data-layout]'

/**
 * Graph step player: one static scene, one paused GSAP timeline (`buildSceneTimeline`) whose labels
 * `s0…sN` are the finished pictures. Play, step and scrub only move the playhead. The caller gates mounting
 * with the `sceneAnimations` flag; other IR kinds keep using {@link Player}.
 */
export function ScenePlayer({
  frames,
  ir,
  renderScene,
  onStepChange,
  onEvidenceClick,
  onEvidenceHighlight,
  defaultSpeed = 1,
  reducedMotion,
  autoPlay = false,
  highlightWhilePlaying = true,
  onHighlightWhilePlayingChange,
}: ScenePlayerProps) {
  const root = useRef<HTMLDivElement>(null)
  // The index belongs to one frames array, so a new array starts again at the base frame.
  const [position, setPosition] = useState({ frames, index: 0 })
  const index = position.frames === frames ? position.index : 0
  const safeIndex = Math.min(index, Math.max(0, frames.length - 1))
  const frame = frames[safeIndex]
  const highlight = useHighlightOption({
    value: highlightWhilePlaying,
    onChange: onHighlightWhilePlayingChange,
  })
  const systemReduced = useReducedMotion()
  const reduced = reducedMotion ?? systemReduced ?? false
  const scene = useMemo(() => renderScene(), [renderScene])

  // Layout is asynchronous (a worker). Wait for the laid-out SVG, and notice when it is replaced or re-laid.
  const [located, setLocated] = useState<Located | null>(null)
  useEffect(() => {
    const element = root.current
    if (!element) return
    let live = true
    let last: Located | null = null
    const locate = (synchronous: boolean) => {
      if (!live) return
      const svg = element.querySelector<SVGSVGElement>(LAID_OUT_SVG)
      const geometry = svg && readSceneGeometry(svg)
      const next =
        svg && geometry ? { svg, key: JSON.stringify(geometry) } : null
      if (next?.svg === last?.svg && next?.key === last?.key) return
      last = next
      // Commit before the browser paints, so the full static picture never flashes between layout and scene 0.
      // (flushSync is not allowed inside an effect, where the first look happens.)
      const update = () =>
        setLocated((now) =>
          now?.svg === next?.svg && now?.key === next?.key ? now : next,
        )
      if (synchronous) flushSync(update)
      else update()
    }
    const observer = new MutationObserver(() => locate(true))
    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-ready', 'data-layout', 'data-box'],
    })
    locate(false)
    return () => {
      live = false
      observer.disconnect()
    }
  }, [])

  // What the timeline currently shows, so that an index change knows whether it is one step forward.
  const shown = useRef<{
    tl: Built['tl']
    index: number
  } | null>(null)
  const playhead = useRef<{ kill: () => unknown } | null>(null)
  const latest = useRef({ index: safeIndex, speed: defaultSpeed })
  const [built, setBuilt] = useState<Built | null>(null)
  const active = built?.frames === frames && built.ir === ir ? built : null

  const change = useCallback(
    (i: number) =>
      setPosition({
        frames,
        index: Math.max(0, Math.min(frames.length - 1, i)),
      }),
    [frames],
  )
  const step = active?.plan.steps.find((s) => s.index === safeIndex)
  const playback = usePlayback({
    // Nothing advances (and a pending autoplay never starts) before there is a timeline to run.
    count: active ? frames.length : 0,
    index: safeIndex,
    onIndex: change,
    delayMs:
      Math.max(1500, (frame?.narration?.length ?? 0) * 45) +
      (step ? (step.end - step.start) * 1000 : 0),
    initialSpeed: defaultSpeed,
  })
  useLayoutEffect(() => {
    latest.current = { index: safeIndex, speed: playback.speed }
  })

  // (Re)build when the frames, the graph or the laid-out SVG change; undo everything first.
  useLayoutEffect(() => {
    const geometry = located && readSceneGeometry(located.svg)
    if (!located || !geometry || !frames.length) {
      setBuilt(null)
      return
    }
    let made: ReturnType<typeof buildSceneTimeline>
    let plan: SceneTimeline
    try {
      plan = compileSceneTimeline(ir, frames, geometry.boxes, geometry.full)
      made = buildSceneTimeline(located.svg, plan)
    } catch (error) {
      console.error('ScenePlayer: the scene timeline could not be built', error)
      setBuilt(null)
      return
    }
    const { tl, ctx } = made
    const at = Math.min(latest.current.index, frames.length - 1)
    tl.seek(`s${at}`)
    shown.current = { tl, index: at }
    setBuilt({ tl, ctx, plan, frames, ir })
    return () => {
      playhead.current?.kill()
      playhead.current = null
      shown.current = null
      ctx.revert()
    }
  }, [located, frames, ir])

  // Follow the index: one step forward plays that step's choreography; any other move jumps.
  useEffect(() => {
    const current = shown.current
    if (!active || !current || current.tl !== active.tl) return
    const from = current.index
    if (from === safeIndex) return
    current.index = safeIndex
    playhead.current?.kill()
    playhead.current = null
    const { tl } = active
    const to = `s${safeIndex}`
    const span = (tl.labels[to] ?? 0) - (tl.labels[`s${from}`] ?? 0)
    if (reduced || safeIndex !== from + 1 || !(span > 0)) {
      tl.seek(to)
      return
    }
    // Outside the context on purpose: the build effect kills it before `ctx.revert()`, which must not
    // re-render the master timeline after its own tweens were undone.
    playhead.current = tl.tweenFromTo(`s${from}`, to, {
      duration: span / latest.current.speed,
      ease: 'none',
    })
  }, [active, safeIndex, reduced])

  // Playing is off until the timeline for these frames exists; then autoplay (once per frames array).
  useEffect(() => {
    playback.setPlaying(false)
  }, [frames, playback.setPlaying])
  const autoplayed = useRef<readonly FrameState[] | null>(null)
  useEffect(() => {
    if (!active || autoplayed.current === frames) return
    autoplayed.current = frames
    playback.setPlaying(autoPlay && !reduced && frames.length > 1)
  }, [active, frames, autoPlay, reduced, playback.setPlaying])

  useEffect(() => {
    onStepChange?.(safeIndex)
  }, [safeIndex, onStepChange])
  useStepHighlight({
    evidence: frame?.evidence,
    enabled: highlight.checked,
    onEvidenceHighlight,
  })

  const controls = {
    count: frames.length,
    index: safeIndex,
    onIndex: change,
    playing: playback.playing,
    onPlaying: playback.setPlaying,
    speed: playback.speed,
    onSpeed: playback.setSpeed,
    loop: playback.loop,
    onLoop: playback.setLoop,
  }
  return (
    <div
      ref={root}
      className="illus-player"
      tabIndex={0}
      role="region"
      aria-label="Animation player"
      data-reduced-motion={!!reduced}
      data-scene-ready={!!active}
      onKeyDown={(e) => {
        if (active) playbackKey(e, controls)
      }}
    >
      {scene}
      {frame ? (
        <>
          <PlaybackControls {...controls} disabled={!active} />
          <Narration frame={frame} onEvidenceClick={onEvidenceClick} />
          <HighlightToggle
            checked={highlight.checked}
            onChange={highlight.onChange}
          />
        </>
      ) : (
        <p>No animation frames available.</p>
      )}
    </div>
  )
}
