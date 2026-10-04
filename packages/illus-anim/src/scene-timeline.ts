import { gsap } from 'gsap'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import type { SceneBox, SceneStep, SceneTimeline } from '@illus/core'

/**
 * The camera is a proxy tween over a view box. `tl.seek(label)` suppresses tween callbacks by default,
 * so an `onUpdate` would leave the camera stale after a jump. A plugin's `render` always runs.
 */
interface CameraMove {
  from: SceneBox
  to: SceneBox
  apply: (box: SceneBox) => void
}
const SceneCameraPlugin = {
  name: 'sceneCamera',
  rawVars: 1, // the value carries a function; GSAP must not call it as a function-based value
  init(this: CameraMove, _target: unknown, move: CameraMove) {
    this.from = move.from
    this.to = move.to
    this.apply = move.apply
  },
  render(ratio: number, move: CameraMove) {
    // Exact at both ends, so a jump and a play-through land on identical camera transforms.
    const mix = (a: number, b: number) =>
      ratio === 0 ? a : ratio === 1 ? b : a + (b - a) * ratio
    move.apply({
      x: mix(move.from.x, move.to.x),
      y: mix(move.from.y, move.to.y),
      width: mix(move.from.width, move.to.width),
      height: mix(move.from.height, move.to.height),
    })
  },
}
gsap.registerPlugin(DrawSVGPlugin, MotionPathPlugin, SceneCameraPlugin)

export interface SceneGeometry {
  boxes: Record<string, SceneBox>
  full: SceneBox
}

/** Reads GraphView's layout coordinates; absent/malformed geometry is not ready to animate. */
export function readSceneGeometry(svg: SVGSVGElement): SceneGeometry | null {
  const numbers = (value: string | null, count: number) => {
    if (!value?.trim()) return null
    const parts = value.trim().split(/\s+/).map(Number)
    return parts.length === count && parts.every(Number.isFinite) ? parts : null
  }
  const layout = numbers(svg.getAttribute('data-layout'), 2)
  if (!layout || layout[0]! <= 0 || layout[1]! <= 0) return null
  const boxes: Record<string, SceneBox> = {}
  for (const target of svg.querySelectorAll('[data-target][data-box]')) {
    const box = numbers(target.getAttribute('data-box'), 4)
    if (!box || box[2]! <= 0 || box[3]! <= 0) return null
    boxes[target.getAttribute('data-target')!] = {
      x: box[0]!,
      y: box[1]!,
      width: box[2]!,
      height: box[3]!,
    }
  }
  if (!Object.keys(boxes).length) return null
  return { boxes, full: { x: 0, y: 0, width: layout[0]!, height: layout[1]! } }
}

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Attributes GSAP writes on elements React renders; `ctx.revert()` can leave them behind. */
const TOUCHED_ATTRIBUTES = [
  'transform',
  'style',
  'data-tone',
  'data-svg-origin',
] as const
/** A zero-duration set exactly on a step's start would also fire when seeking to the previous label. */
const STEP_START_NUDGE = 0.001
/** Edge ornaments that wait for the stroke: arrow head, label background and label text. */
const EDGE_ORNAMENTS = '.illus-edge-head, .illus-label-bg, .illus-edge-label'
const TEXT_ATTRIBUTES = {
  'text-anchor': 'middle',
  fill: 'var(--illus-fg)',
  'font-size': '11',
  'font-family': 'var(--illus-font)',
}

function overlayElement<K extends 'circle' | 'text'>(
  tag: K,
  className: string,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag)
  el.classList.add(className)
  // Presentation attributes (not inline style), so that a stylesheet rule can still override them.
  el.setAttribute('pointer-events', 'none')
  for (const [name, value] of Object.entries(attributes))
    el.setAttribute(name, value)
  return el
}

/**
 * Paused master timeline with labels s0…sN; label `sI` is the finished picture of step `I`.
 * Everything GSAP and this function create lives in `ctx`; `ctx.revert()` restores the static SVG.
 *
 * GSAP writes SVG transforms as a `transform` attribute, and React renders one on each node's outer
 * `<g>`. So GSAP only ever animates the inner `[data-anim-body]` wrappers (opacity, and scale about
 * their own centre) and overlay elements created here. The camera `<g>` carries no React transform;
 * `applyCamera` writes it.
 */
export function buildSceneTimeline(
  svg: SVGSVGElement,
  plan: SceneTimeline,
): { tl: gsap.core.Timeline; ctx: gsap.Context } {
  const geometry = readSceneGeometry(svg)
  const camera = svg.querySelector<SVGGElement>('[data-camera]')
  const overlay = svg.querySelector<SVGGElement>('[data-scene-overlay]')
  if (!geometry || !camera || !overlay)
    throw new Error('Scene graph layout is not ready')
  const { full, boxes } = geometry
  const originalCamera = camera.getAttribute('transform')
  const created: SVGElement[] = []
  const snapshots = new Map<Element, (string | null)[]>()
  const remember = <E extends Element>(el: E): E => {
    if (!snapshots.has(el))
      snapshots.set(
        el,
        TOUCHED_ATTRIBUTES.map((name) => el.getAttribute(name)),
      )
    return el
  }
  const body = (target: string) => {
    const el = svg.querySelector<SVGGElement>(
      `[data-target="${CSS.escape(target)}"] > [data-anim-body]`,
    )
    return el && remember(el)
  }
  const edgeLine = (target: string) => {
    const line = body(target)?.querySelector<SVGPathElement>('.illus-edge-line')
    return line && remember(line)
  }
  const applyCamera = (box: SceneBox) => {
    const scale = Math.min(full.width / box.width, full.height / box.height)
    const x = full.x + (full.width - box.width * scale) / 2 - box.x * scale
    const y = full.y + (full.height - box.height * scale) / 2 - box.y * scale
    camera.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`)
  }
  const appendOverlay = <E extends SVGElement>(el: E): E => {
    overlay.append(el)
    created.push(el)
    return el
  }

  let tl!: gsap.core.Timeline
  const ctx = gsap.context(() => {
    tl = gsap.timeline({ paused: true })
    const cameraTarget = {}
    const moveCamera = (
      from: SceneBox,
      to: SceneBox,
      duration: number,
      at: number,
    ) =>
      tl.to(
        cameraTarget,
        {
          sceneCamera: { from, to, apply: applyCamera },
          duration,
          ease: 'power2.inOut',
          immediateRender: false,
        },
        at,
      )

    // Initial state, all at time 0, so that seeking back to s0 restores it.
    const opacity = new Map<string, number>() // each target's opacity after the tweens added so far
    for (const el of svg.querySelectorAll<SVGGElement>(
      '[data-target] > [data-anim-body]',
    )) {
      const target = el.parentElement!.getAttribute('data-target')!
      const initial = plan.initial.visible.has(target)
        ? 1
        : plan.initial.faded.has(target)
        ? 0.15
        : 0
      opacity.set(target, initial)
      tl.set(
        remember(el),
        {
          opacity: initial,
          attr: { 'data-tone': plan.initial.tones[target] ?? 'none' },
        },
        0,
      )
    }
    applyCamera(plan.initialCamera)
    moveCamera(plan.initialCamera, plan.initialCamera, 0, 0)

    // One text element per (target, text), created on first use; its opacity says whether it shows.
    const annotations = new Map<string, SVGTextElement>()
    const shown = new Map<string, SVGTextElement>()
    const annotation = (target: string, text: string) => {
      const key = JSON.stringify([target, text])
      const known = annotations.get(key)
      if (known) return known
      const box = boxes[target]
      if (!box) return null
      const el = appendOverlay(
        overlayElement('text', 'illus-annotation-text', {
          ...TEXT_ATTRIBUTES,
          'data-annotation-target': target,
          x: String(box.x + box.width / 2),
          y: String(box.y - 6),
        }),
      )
      el.textContent = text
      annotations.set(key, el)
      tl.set(el, { opacity: 0 }, 0)
      return el
    }
    for (const [target, text] of Object.entries(plan.initial.annotations)) {
      const el = annotation(target, text)
      if (!el) continue
      tl.set(el, { opacity: 1 }, 0)
      shown.set(target, el)
    }

    // Fade and scale a body in. A body coming back from faded keeps its faded opacity as the start
    // instead of dipping to zero, so seeking to the step before it restores the faded picture.
    const appear = (
      el: SVGGElement,
      target: string,
      at: number,
      duration: number,
    ) => {
      const was = opacity.get(target) ?? 0
      tl.fromTo(
        el,
        was > 0
          ? { opacity: was, scale: 1, transformOrigin: '50% 50%' }
          : { opacity: 0, scale: 0.92, transformOrigin: '50% 50%' },
        {
          opacity: 1,
          scale: 1,
          duration,
          ease: 'power2.out',
          immediateRender: false,
        },
        at,
      )
      opacity.set(target, 1)
    }

    const addTween = (
      step: SceneStep,
      tween: SceneStep['tweens'][number],
      // Zero-duration sets that sit exactly on a step's start belong to this step, not the last one.
      setAt: (at: number) => number,
    ) => {
      switch (tween.kind) {
        case 'camera':
          moveCamera(tween.from, tween.to, tween.duration, tween.at)
          return
        case 'annotate': {
          const previous = shown.get(tween.target)
          if (previous) tl.set(previous, { opacity: 0 }, setAt(tween.at))
          shown.delete(tween.target)
          const el =
            tween.text === null ? null : annotation(tween.target, tween.text)
          if (el) {
            tl.set(el, { opacity: 1 }, setAt(tween.at))
            shown.set(tween.target, el)
          }
          return
        }
        case 'token': {
          const lines = tween.edges.map((id) => edgeLine(`edge:${id}`))
          if (!lines.length || lines.some((line) => !line)) return
          const name = `${step.index}:${tween.id}`
          const riders: { el: SVGElement; alignOrigin: [number, number] }[] = [
            {
              el: appendOverlay(
                overlayElement('circle', 'illus-token-dot', {
                  r: '6',
                  fill: 'var(--illus-accent)',
                  'data-scene-token': name,
                }),
              ),
              alignOrigin: [0.5, 0.5],
            },
          ]
          if (tween.label !== undefined) {
            const label = appendOverlay(
              overlayElement('text', 'illus-annotation-text', {
                ...TEXT_ATTRIBUTES,
                'data-scene-token-label': name,
              }),
            )
            label.textContent = tween.label
            // The label rides just above its dot instead of on top of it.
            riders.push({ el: label, alignOrigin: [0.5, 1.7] })
          }
          const leg = tween.duration / lines.length
          for (const { el, alignOrigin } of riders) {
            tl.set(el, { opacity: 0 }, 0)
            tl.set(el, { opacity: 1 }, setAt(tween.at))
            lines.forEach((line, k) =>
              tl.to(
                el,
                {
                  motionPath: { path: line!, align: line!, alignOrigin },
                  duration: leg,
                  ease: 'none',
                  immediateRender: false,
                },
                tween.at + k * leg,
              ),
            )
            tl.set(el, { opacity: 0 }, tween.at + tween.duration)
          }
          return
        }
      }
      const el = body(tween.target)
      if (!el) return
      switch (tween.kind) {
        case 'show':
          appear(el, tween.target, tween.at, tween.duration)
          break
        case 'hide':
        case 'fade': {
          const to = tween.kind === 'fade' ? 0.15 : 0
          // The start is the previous scene's opacity, never what the DOM happens to show now.
          tl.fromTo(
            el,
            { opacity: opacity.get(tween.target) ?? 0 },
            { opacity: to, duration: tween.duration, immediateRender: false },
            tween.at,
          )
          opacity.set(tween.target, to)
          break
        }
        case 'draw': {
          const line = edgeLine(tween.target)
          // DrawSVG would erase a dashed stroke's pattern; those edges fade in instead.
          if (!line || el.parentElement?.classList.contains('illus-dashed')) {
            appear(el, tween.target, tween.at, tween.duration)
            break
          }
          tl.set(el, { opacity: 1 }, setAt(tween.at))
          tl.fromTo(
            line,
            { drawSVG: '0%' },
            {
              drawSVG: '100%',
              duration: tween.duration,
              ease: 'power1.inOut',
              immediateRender: false,
            },
            tween.at,
          )
          const ornaments = Array.from(
            el.querySelectorAll<SVGElement>(EDGE_ORNAMENTS),
          ).map(remember)
          if (ornaments.length) {
            tl.set(ornaments, { opacity: 0 }, setAt(tween.at))
            tl.fromTo(
              ornaments,
              { opacity: 0 },
              { opacity: 1, duration: 0.15, immediateRender: false },
              tween.at + tween.duration * 0.8,
            )
          }
          opacity.set(tween.target, 1)
          break
        }
        case 'tone':
          tl.set(
            el,
            { attr: { 'data-tone': tween.tone ?? 'none' } },
            setAt(tween.at),
          )
          break
      }
    }

    tl.addLabel('s0', 0)
    for (const step of plan.steps) {
      const setAt = (at: number) =>
        at <= step.start ? step.start + STEP_START_NUDGE : at
      for (const tween of step.tweens) addTween(step, tween, setAt)
      tl.addLabel(`s${step.index}`, step.end)
    }
    // Keep minimum-length and tween-free steps seekable: the labels must lie inside the timeline.
    if (plan.duration) tl.to({}, { duration: plan.duration }, 0)
    // A paused timeline never renders time 0 by itself, so `seek('s0')` would not apply the initial
    // state. Play through once and come back; every start value is then recorded in step order.
    tl.progress(1).progress(0)

    return () => {
      created.forEach((el) => el.remove())
      snapshots.forEach((values, el) =>
        TOUCHED_ATTRIBUTES.forEach((name, i) => {
          const value = values[i] ?? null
          if (value === null) el.removeAttribute(name)
          else el.setAttribute(name, value)
        }),
      )
      if (originalCamera === null) camera.removeAttribute('transform')
      else camera.setAttribute('transform', originalCamera)
    }
  }, svg)
  return { tl, ctx }
}
