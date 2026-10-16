import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { animate } from 'motion'
import { useReducedMotion } from 'motion/react'
import type { Evidence, FrameState } from '@illus/core'
import { PlaybackControls, playbackKey, usePlayback } from './transport.tsx'

export interface PlayerProps {
  frames: readonly FrameState[]
  renderFrame: (frame: FrameState) => ReactNode
  onStepChange?: (index: number) => void
  onEvidenceClick?: (evidence: Evidence) => void
  onEvidenceHighlight?: (evidence: Evidence | null) => void
  /** Persisted reader setting; reapplied only when this prop changes. */
  defaultSpeed?: number
  /** Undefined follows prefers-reduced-motion; explicit booleans override it. */
  reducedMotion?: boolean
  /** Play through once when the frames arrive (never with reduced motion), ending on the full picture. */
  autoPlay?: boolean
  /** Initial value of "Highlight passage while playing". */
  highlightWhilePlaying?: boolean
}

/** A screen-pixel offset in the element's own coordinates (SVG viewBox scaling, pane zoom). */
function localDelta(element: Element, dx: number, dy: number) {
  if (!dx && !dy) return { x: 0, y: 0 }
  const parent = element.parentElement
  const matrix =
    element instanceof SVGElement && parent instanceof SVGGraphicsElement
      ? parent.getScreenCTM()
      : null
  if (matrix) {
    const inverse = matrix.inverse()
    return {
      x: inverse.a * dx + inverse.c * dy,
      y: inverse.b * dx + inverse.d * dy,
    }
  }
  const scale = Number(
    element.closest('[data-zoom]')?.getAttribute('data-zoom') ?? 1,
  )
  return { x: dx / scale, y: dy / scale }
}

/** Precomputed frame player. The caller gates mounting with featureFlags.animation. */
export function Player({
  frames,
  renderFrame,
  onStepChange,
  onEvidenceClick,
  onEvidenceHighlight,
  defaultSpeed = 1,
  reducedMotion,
  autoPlay = false,
  highlightWhilePlaying = true,
}: PlayerProps) {
  const [index, setIndex] = useState(0)
  const [autoHighlight, setAutoHighlight] = useState(highlightWhilePlaying)
  const root = useRef<HTMLDivElement>(null)
  const [surfaceVersion, setSurfaceVersion] = useState(0)
  const systemReduced = useReducedMotion()
  const reduced = reducedMotion ?? systemReduced ?? false
  const safeIndex = Math.min(index, Math.max(0, frames.length - 1))
  const frame = frames[safeIndex]
  const change = useCallback(
    (i: number) => setIndex(Math.max(0, Math.min(frames.length - 1, i))),
    [frames.length],
  )
  const playback = usePlayback({
    count: frames.length,
    index: safeIndex,
    onIndex: change,
    delayMs: Math.max(1500, (frame?.narration?.length ?? 0) * 45),
    initialSpeed: defaultSpeed,
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
  const priorFrames = useRef(frames)
  useEffect(() => {
    if (priorFrames.current !== frames) {
      priorFrames.current = frames
      setIndex(0)
      playback.setPlaying(autoPlay && !reduced && frames.length > 1)
    }
  }, [frames, playback.setPlaying, autoPlay, reduced])
  // Mount only: later frame changes are handled above.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoStarted.current) return
    autoStarted.current = true
    if (autoPlay && !reduced && frames.length > 1) playback.setPlaying(true)
  })
  useEffect(() => {
    onStepChange?.(safeIndex)
  }, [safeIndex, onStepChange])
  useEffect(() => {
    onEvidenceHighlight?.(
      playback.playing && autoHighlight ? frame?.evidence ?? null : null,
    )
    return () => onEvidenceHighlight?.(null)
  }, [playback.playing, autoHighlight, frame?.evidence, onEvidenceHighlight])
  const previous = useRef(
    new Map<string, { x: number; y: number; opacity: number; fill: string }>(),
  )
  useEffect(() => {
    if (!root.current) return
    const observer = new MutationObserver((records) => {
      if (
        records.some((record) =>
          Array.from(record.addedNodes).some(
            (node) =>
              node instanceof Element &&
              (node.matches('[data-token-id]') ||
                !!node.querySelector('[data-token-id]')),
          ),
        )
      )
        setSurfaceVersion((v) => v + 1)
    })
    observer.observe(root.current, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (!root.current || !frame) return
    const stops: { stop: () => void }[] = []
    const next = new Map<
      string,
      { x: number; y: number; opacity: number; fill: string }
    >()
    const targets = Array.from(
      root.current.querySelectorAll<SVGElement>('[data-target]'),
    )
    for (const element of targets) {
      const target = element.getAttribute('data-target')!
      const rect = element.getBoundingClientRect(),
        css = getComputedStyle(element)
      const now = {
        x: rect.x,
        y: rect.y,
        opacity: Number(css.opacity),
        fill: css.fill,
      }
      const before = previous.current.get(target)
      next.set(target, now)
      if (!reduced && before && typeof element.animate === 'function') {
        const offset = localDelta(element, before.x - now.x, before.y - now.y)
        if (
          offset.x ||
          offset.y ||
          before.opacity !== now.opacity ||
          before.fill !== now.fill
        ) {
          // The CSS `translate` property composes with an SVG `transform` attribute (graph nodes are
          // positioned by one); a CSS `transform` would replace it and send the node to the origin.
          // No fill mode: once done, nothing stays inline to mask the next frame's classes.
          const animation = element.animate(
            [
              {
                translate: `${offset.x}px ${offset.y}px`,
                opacity: before.opacity,
                fill: before.fill,
              },
              { translate: '0px 0px', opacity: now.opacity, fill: now.fill },
            ],
            { duration: 300 / playback.speed, easing: 'ease-out' },
          )
          stops.push({ stop: () => animation.cancel() })
        }
      }
    }
    previous.current = next
    const tokens = Array.from(
      root.current.querySelectorAll<SVGGraphicsElement | HTMLElement>(
        '[data-token-id]',
      ),
    )
    for (const token of frame.tokens) {
      const element = tokens.find(
        (el) => el.getAttribute('data-token-id') === token.id,
      )
      if (!element) continue
      const paths = token.path
        .map((id) =>
          targets.find((el) => el.getAttribute('data-target') === `edge:${id}`),
        )
        .map((el) =>
          el?.matches('path,line') ? el : el?.querySelector('path,line'),
        )
        .filter(
          (el): el is SVGGeometryElement =>
            !!el &&
            typeof (el as SVGGeometryElement).getPointAtLength === 'function',
        )
      if (!paths.length) continue
      const lengths = paths.map((p) => p.getTotalLength()),
        total = lengths.reduce((a, b) => a + b, 0)
      const svgToken = element instanceof SVGGraphicsElement
      const box = svgToken ? element.getBBox() : null,
        origin = box
          ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
          : { x: 0, y: 0 }
      const position = (progress: number) => {
        let distance = progress * total,
          i = 0
        while (i < paths.length - 1 && distance > lengths[i]!) {
          distance -= lengths[i]!
          i++
        }
        const path = paths[i]!,
          point = path.getPointAtLength(Math.min(distance, lengths[i]!))
        if (svgToken) {
          const parentMatrix =
            element.parentElement instanceof SVGGraphicsElement
              ? element.parentElement.getCTM()
              : null
          const world = new DOMPoint(point.x, point.y).matrixTransform(
            path.getCTM() ?? new DOMMatrix(),
          )
          const local = parentMatrix
            ? world.matrixTransform(parentMatrix.inverse())
            : world
          element.setAttribute(
            'transform',
            `translate(${local.x - origin.x} ${local.y - origin.y})`,
          )
        } else {
          const world = new DOMPoint(point.x, point.y).matrixTransform(
            path.getScreenCTM() ?? new DOMMatrix(),
          )
          const parent = element.parentElement!.getBoundingClientRect(),
            scale = Number(
              element.closest('[data-zoom]')?.getAttribute('data-zoom') ?? 1,
            )
          element.style.left = `${(world.x - parent.left) / scale}px`
          element.style.top = `${(world.y - parent.top) / scale}px`
        }
      }
      if (reduced) position(1)
      else {
        position(0)
        stops.push(
          animate(0, 1, { duration: 0.6 / playback.speed, onUpdate: position }),
        )
      }
    }
    return () => stops.forEach((s) => s.stop())
  }, [frame, reduced, playback.speed, surfaceVersion])
  if (!frame) return <p>No animation frames available.</p>
  return (
    <div
      ref={root}
      className="illus-player"
      tabIndex={0}
      role="region"
      aria-label="Animation player"
      data-reduced-motion={!!reduced}
      onKeyDown={(e) => playbackKey(e, controls)}
    >
      {renderFrame(frame)}
      <PlaybackControls {...controls} />
      <div className="illus-narration" aria-live="polite" aria-atomic="true">
        {frame.narration ? (
          <button
            type="button"
            onClick={() => frame.evidence && onEvidenceClick?.(frame.evidence)}
          >
            {frame.narration}
          </button>
        ) : (
          <span>Initial state</span>
        )}
      </div>
      <label className="illus-player-option">
        <input
          type="checkbox"
          checked={autoHighlight}
          onChange={(e) => setAutoHighlight(e.target.checked)}
        />
        Highlight passage while playing
      </label>
    </div>
  )
}
