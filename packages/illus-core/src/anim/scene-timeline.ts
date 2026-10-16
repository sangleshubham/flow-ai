import type { FrameState, HighlightTone } from '../schemas/animation.ts'
import type { GraphIR } from '../schemas/ir.ts'
import { cameraBox, sceneOf } from './scene.ts'
import type { Scene, SceneBox } from './scene.ts'

export type SceneTween =
  | { kind: 'show'; target: string; at: number; duration: number }
  | { kind: 'hide'; target: string; at: number; duration: number }
  | { kind: 'fade'; target: string; at: number; duration: number }
  | { kind: 'draw'; target: string; at: number; duration: number }
  | { kind: 'tone'; target: string; tone: HighlightTone | null; at: number }
  | { kind: 'annotate'; target: string; text: string | null; at: number }
  | {
      kind: 'token'
      id: string
      label?: string
      edges: string[]
      at: number
      duration: number
    }
  | {
      kind: 'camera'
      from: SceneBox
      to: SceneBox
      at: number
      duration: number
    }

/** One transition, indexed 1…N; the initial scene is separate at time zero. */
export interface SceneStep {
  index: number
  start: number
  end: number
  tweens: SceneTween[]
}
export interface SceneTimeline {
  initial: Scene
  initialCamera: SceneBox
  steps: SceneStep[]
  duration: number
}

function tweenEnd(tween: SceneTween): number {
  // R4a's draw ornaments start at 80% of the stroke and fade over .15s. Wait for their tail too.
  if (tween.kind === 'draw')
    return tween.at + Math.max(tween.duration, tween.duration * 0.8 + 0.15)
  return tween.at + ('duration' in tween ? tween.duration : 0)
}
function cameraChanged(from: SceneBox, to: SceneBox): boolean {
  return [
    from.x - to.x,
    from.y - to.y,
    from.x + from.width - to.x - to.width,
    from.y + from.height - to.y - to.height,
  ].some((delta) => Math.abs(delta) > 1)
}

/** Compile complete graph scenes into deterministic choreography at speed 1, without DOM access. */
export function compileSceneTimeline(
  ir: GraphIR,
  frames: readonly FrameState[],
  boxes: Readonly<Record<string, SceneBox>>,
  full: SceneBox,
): SceneTimeline {
  if (!frames.length)
    throw new Error('A scene timeline requires an initial frame')
  const initial = sceneOf(ir, frames[0]!)
  const initialCamera = cameraBox(initial, boxes, full)
  const steps: SceneStep[] = []
  const targets = [
    ...ir.nodes.map((node) => `node:${node.id}`),
    ...ir.edges.map((edge) => `edge:${edge.id}`),
    ...ir.groups.map((group) => `group:${group.id}`),
  ]
  const bodies = [
    ...ir.nodes.map((node) => `node:${node.id}`),
    ...ir.groups.map((group) => `group:${group.id}`),
  ]
  let previous = initial
  let previousCamera = initialCamera
  let time = 0
  for (let index = 1; index < frames.length; index++) {
    const scene = sceneOf(ir, frames[index]!)
    const camera = cameraBox(scene, boxes, full)
    const tweens: SceneTween[] = []
    const appearing = new Map<string, number>()
    if (cameraChanged(previousCamera, camera)) {
      tweens.push({
        kind: 'camera',
        from: previousCamera,
        to: camera,
        at: time,
        duration: 0.5,
      })
      // Sub-threshold moves do not run, so compare future cameras against the actual last view.
      previousCamera = camera
    }
    for (const target of targets) {
      const wasVisible = previous.visible.has(target)
      const wasFaded = previous.faded.has(target)
      if (scene.faded.has(target) && !wasFaded)
        tweens.push({ kind: 'fade', target, at: time, duration: 0.3 })
      else if (
        !scene.visible.has(target) &&
        !scene.faded.has(target) &&
        (wasVisible || wasFaded)
      )
        tweens.push({ kind: 'hide', target, at: time, duration: 0.3 })
    }
    for (const target of Object.keys(previous.tones))
      if (!(target in scene.tones))
        tweens.push({ kind: 'tone', target, tone: null, at: time })
    let stagger = 0
    for (const target of bodies) {
      if (!scene.visible.has(target) || previous.visible.has(target)) continue
      const show: SceneTween = {
        kind: 'show',
        target,
        at: time + 0.2 + stagger++ * 0.08,
        duration: 0.35,
      }
      tweens.push(show)
      appearing.set(target, tweenEnd(show))
    }
    for (const edge of ir.edges) {
      const target = `edge:${edge.id}`
      if (!scene.visible.has(target) || previous.visible.has(target)) continue
      const at = Math.max(
        time + 0.2,
        appearing.get(`node:${edge.from}`) ?? time,
        appearing.get(`node:${edge.to}`) ?? time,
      )
      const tween: SceneTween =
        edge.style === 'dashed'
          ? { kind: 'show', target, at, duration: 0.3 }
          : { kind: 'draw', target, at, duration: 0.35 }
      tweens.push(tween)
      appearing.set(target, tweenEnd(tween))
    }
    for (const [target, tone] of Object.entries(scene.tones))
      if (previous.tones[target] !== tone)
        tweens.push({
          kind: 'tone',
          target,
          tone,
          at: appearing.get(target) ?? time + 0.2,
        })
    for (const target of new Set([
      ...Object.keys(previous.annotations),
      ...Object.keys(scene.annotations),
    ]))
      if (previous.annotations[target] !== scene.annotations[target])
        tweens.push({
          kind: 'annotate',
          target,
          text: scene.annotations[target] ?? null,
          at: time + 0.2,
        })
    const tokenStart = Math.max(time, ...tweens.map(tweenEnd))
    for (const token of scene.tokens) {
      if (
        !token.path.length ||
        !token.path.every((id) => scene.visible.has(`edge:${id}`))
      )
        continue
      tweens.push({
        kind: 'token',
        id: token.id,
        ...(token.label === undefined ? {} : { label: token.label }),
        edges: [...token.path],
        at: tokenStart,
        duration: 0.8,
      })
    }
    const end = Math.max(time + 0.4, ...tweens.map(tweenEnd))
    steps.push({ index, start: time, end, tweens })
    previous = scene
    time = end
  }
  return { initial, initialCamera, steps, duration: time }
}
