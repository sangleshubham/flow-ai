// Step-animation DSL (§11). The reducer that turns steps into frames lives in @illus/core/anim (W6);
// this file only defines the data contracts, including FrameState so renderers (W4) can draw frames
// before the reducer exists.
import { z } from 'zod'

import { Evidence, Label } from './common.ts'

/** An addressable element of a validated IR or template instance (§11). */
export const Target = z.union([
  z.templateLiteral(['node:', z.string().min(1)]),
  z.templateLiteral(['edge:', z.string().min(1)]),
  z.templateLiteral(['group:', z.string().min(1)]),
  z.templateLiteral(['msg:', z.string().min(1)]),
  z.templateLiteral(['cell:', z.string().min(1), '[', z.number().int(), ']']),
  z.templateLiteral(['item:', z.string().min(1)]),
])
export type Target = z.infer<typeof Target>

export const HighlightTone = z.enum(['focus', 'success', 'warning', 'muted'])
export type HighlightTone = z.infer<typeof HighlightTone>

const Value = z.union([z.string(), z.number()])

/** One animation action (§11). Unknown targets or unsupported actions fail at frame-build time. */
export const Action = z.discriminatedUnion('op', [
  z.object({ op: z.literal('highlight'), target: Target, tone: HighlightTone }),
  z.object({ op: z.literal('unhighlight'), target: z.union([Target, z.literal('all')]) }),
  z.object({ op: z.literal('reveal'), target: Target }),
  z.object({ op: z.literal('hide'), target: Target }),
  z.object({ op: z.literal('set'), target: Target, value: Value }),
  z.object({ op: z.literal('swap'), a: Target, b: Target }),
  /** Named pointer such as i, j, head, slow, fast; `null` removes it. */
  z.object({ op: z.literal('pointer'), name: z.string().min(1), target: Target.nullable() }),
  z.object({ op: z.literal(['push', 'enqueue']), container: z.string().min(1), id: z.string().min(1), value: Value }),
  z.object({ op: z.literal(['pop', 'dequeue']), container: z.string().min(1) }),
  /** The template decides placement. */
  z.object({
    op: z.literal('add'),
    parent: z.string().min(1).optional(),
    element: z.object({ id: z.string().min(1), label: Label }),
  }),
  z.object({ op: z.literal('remove'), target: Target }),
  /** A token travelling along edge ids, in order; lasts one step. */
  z.object({ op: z.literal('token'), id: z.string().min(1), label: Label.optional(), path: z.array(z.string().min(1)).min(1) }),
  /** ≤ 40 characters, cleared on the next step. */
  z.object({ op: z.literal('annotate'), target: Target, text: z.string().min(1).max(40) }),
  /** Camera pan/zoom. */
  z.object({ op: z.literal('focus'), target: z.union([Target, z.literal('all')]) }),
])
export type Action = z.infer<typeof Action>
export type ActionOp = Action['op']

/** All action ops, for templates' `supportedActions` lists. */
export const ACTION_OPS: readonly ActionOp[] = [
  'highlight',
  'unhighlight',
  'reveal',
  'hide',
  'set',
  'swap',
  'pointer',
  'push',
  'enqueue',
  'pop',
  'dequeue',
  'add',
  'remove',
  'token',
  'annotate',
  'focus',
]

/** One step: narration ≤ 140 characters, grounded, ≤ 6 actions (§11). */
export const Step = z.object({
  id: z.string().min(1),
  narration: z.string().min(1).max(140),
  evidence: Evidence,
  actions: z.array(Action).max(6),
})
export type Step = z.infer<typeof Step>

/** Output of the `animator` role (§11): 2–40 steps over an already-validated IR. */
export const AnimationIR = z.object({
  planItemId: z.string().min(1),
  /** Elements revealed by later steps (progressive build-up). */
  initialHidden: z.array(Target),
  steps: z.array(Step).min(2).max(40),
})
export type AnimationIR = z.infer<typeof AnimationIR>

/**
 * Precomputed state of one animation frame (§11 reducer). `frames[0]` is the base spec with
 * `initialHidden` applied (`step: 0`); `frames[i]` has `steps[0..i-1]` applied (`step: i`).
 *
 * Persistence follows §11: highlights persist until `unhighlight`; pointers persist until moved or set to
 * `null` (then the key is removed); `annotations` and `tokens` hold only the current step's. Records are
 * keyed by `Target` string (or pointer name / container id) so frames stay JSON-serialisable.
 */
export const FrameState = z.object({
  /** Number of steps applied (0 = base frame). */
  step: z.number().int().nonnegative(),
  /** Id of the step that produced this frame; absent on the base frame. */
  stepId: z.string().min(1).optional(),
  narration: z.string().optional(),
  evidence: Evidence.optional(),
  /** Hidden elements: `initialHidden` plus `hide`, minus `reveal`. */
  hidden: z.array(Target),
  /** Elements removed by `remove`, `pop` or `dequeue`; renderers fade them out. */
  removed: z.array(Target),
  highlights: z.record(z.string(), HighlightTone),
  /** Pointer name → target it points at. */
  pointers: z.record(z.string(), Target),
  /** Values written by `set` (target → displayed value). */
  values: z.record(z.string(), Value),
  /** Element → slot it currently occupies after `swap`s (only moved elements are listed). */
  slots: z.record(z.string(), Target),
  /** Container id → current items, for containers touched by `push`/`pop`/`enqueue`/`dequeue`. */
  containers: z.record(z.string(), z.array(z.object({ id: z.string().min(1), value: Value }))),
  /** Elements created by `add`, in order. */
  added: z.array(z.object({ id: z.string().min(1), label: Label, parent: z.string().min(1).optional() })),
  /** Annotations of the current step only. */
  annotations: z.record(z.string(), z.string().max(40)),
  /** Tokens of the current step only. */
  tokens: z.array(z.object({ id: z.string().min(1), label: Label.optional(), path: z.array(z.string().min(1)) })),
  /** Camera target; `null` means the default framing. */
  focus: z.union([Target, z.literal('all')]).nullable(),
  /** True when this step changed structure (`add`, `remove`, `push`, `pop`, node `reveal`): re-run layout (§11). */
  relayout: z.boolean(),
})
export type FrameState = z.infer<typeof FrameState>

/** The base frame: nothing applied except `initialHidden`. */
export function emptyFrame(initialHidden: readonly Target[] = []): FrameState {
  return {
    step: 0,
    hidden: [...initialHidden],
    removed: [],
    highlights: {},
    pointers: {},
    values: {},
    slots: {},
    containers: {},
    added: [],
    annotations: {},
    tokens: [],
    focus: null,
    relayout: false,
  }
}
