import type { FrameState, HighlightTone } from '../schemas/animation.ts'
import type { GraphIR } from '../schemas/ir.ts'
import { withDerivedVisibility } from './visibility.ts'

export interface SceneBox {
  x: number
  y: number
  width: number
  height: number
}
export interface Scene {
  step: number
  /** node:/edge:/group: targets drawn at full opacity. */
  visible: ReadonlySet<string>
  /** Removed, non-hidden targets drawn faded (opacity 0.15). Hidden always wins. */
  faded: ReadonlySet<string>
  tones: Readonly<Record<string, HighlightTone>>
  annotations: Readonly<Record<string, string>>
  tokens: FrameState['tokens']
  /** Frame focus, with 'all' mapped to null. */
  focus: string | null
}

/** A complete scene independent of the animation's prior frames. */
export function sceneOf(ir: GraphIR, frame: FrameState): Scene {
  const shown = withDerivedVisibility(ir, frame)
  const hidden = new Set<string>(shown.hidden)
  const removed = new Set<string>(shown.removed)
  const targets = [
    ...ir.nodes.map((node) => `node:${node.id}`),
    ...ir.edges.map((edge) => `edge:${edge.id}`),
    ...ir.groups.map((group) => `group:${group.id}`),
  ]
  return {
    step: shown.step,
    visible: new Set(
      targets.filter((target) => !hidden.has(target) && !removed.has(target)),
    ),
    faded: new Set(
      targets.filter((target) => !hidden.has(target) && removed.has(target)),
    ),
    tones: { ...shown.highlights },
    annotations: { ...shown.annotations },
    tokens: shown.tokens.map((token) => ({ ...token, path: [...token.path] })),
    focus: shown.focus === 'all' ? null : shown.focus,
  }
}

/** Fit visible nodes/groups (or explicit focus) while keeping a stable minimum view and full bounds. */
export function cameraBox(
  scene: Scene,
  boxes: Readonly<Record<string, SceneBox>>,
  full: SceneBox,
  o: { padding?: number; minFraction?: number } = {},
): SceneBox {
  let base = scene.focus ? boxes[scene.focus] : undefined
  if (!base) {
    const visible = [...scene.visible]
      .filter(
        (target) => target.startsWith('node:') || target.startsWith('group:'),
      )
      .map((target) => boxes[target])
      .filter((box): box is SceneBox => !!box)
    if (!visible.length) return { ...full }
    const left = Math.min(...visible.map((box) => box.x))
    const top = Math.min(...visible.map((box) => box.y))
    base = {
      x: left,
      y: top,
      width: Math.max(...visible.map((box) => box.x + box.width)) - left,
      height: Math.max(...visible.map((box) => box.y + box.height)) - top,
    }
  }
  const padding = o.padding ?? 24
  const minFraction = o.minFraction ?? 0.45
  const width = Math.min(
    full.width,
    Math.max(base.width + 2 * padding, full.width * minFraction),
  )
  const height = Math.min(
    full.height,
    Math.max(base.height + 2 * padding, full.height * minFraction),
  )
  const x = Math.max(
    full.x,
    Math.min(full.x + full.width - width, base.x + base.width / 2 - width / 2),
  )
  const y = Math.max(
    full.y,
    Math.min(
      full.y + full.height - height,
      base.y + base.height / 2 - height / 2,
    ),
  )
  const round = (value: number) => Math.round(value * 10) / 10
  return {
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
  }
}
