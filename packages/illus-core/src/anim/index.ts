import {
  AnimationIR,
  FrameState,
  Target,
  emptyFrame,
} from '../schemas/animation.ts'
import type { Action, ActionOp } from '../schemas/animation.ts'
import type { IR } from '../schemas/ir.ts'
import type { GroundingContext, TemplateRegistry } from '../schemas/ports.ts'
import type { ValidationIssue } from '../schemas/quality.ts'
import { ground } from '../grounding/index.ts'
import { projectTemplateFrame } from './project.ts'

export interface AnimationOptions {
  templates?: TemplateRegistry
  /** Mandatory for validateAnimation; only permitted section blocks may be supplied. */
  grounding?: GroundingContext
}

/** Pure step reducer. Build through buildFrames to resolve targets and validate invariants. */
export function apply(
  previous: FrameState,
  actions: readonly Action[],
): FrameState {
  let f: FrameState = {
    ...previous,
    step: previous.step + 1,
    annotations: {},
    tokens: [],
    relayout: false,
  }
  const remove = (target: Target) => {
    f = {
      ...f,
      removed: [...new Set([...f.removed, target])],
      pointers: Object.fromEntries(
        Object.entries(f.pointers).filter(([, t]) => t !== target),
      ),
      relayout: true,
    }
  }
  for (const a of actions) {
    switch (a.op) {
      case 'highlight':
        f = { ...f, highlights: { ...f.highlights, [a.target]: a.tone } }
        break
      case 'unhighlight':
        f = {
          ...f,
          highlights:
            a.target === 'all'
              ? {}
              : Object.fromEntries(
                  Object.entries(f.highlights).filter(([t]) => t !== a.target),
                ),
        }
        break
      case 'hide':
        f = { ...f, hidden: [...new Set([...f.hidden, a.target])] }
        break
      case 'reveal':
        f = {
          ...f,
          hidden: f.hidden.filter((t) => t !== a.target),
          relayout: f.relayout || a.target.startsWith('node:'),
        }
        break
      case 'set':
        f = { ...f, values: { ...f.values, [a.target]: a.value } }
        break
      case 'swap': {
        if (a.a === a.b) break
        const slots = { ...f.slots }
        const occupant = (t: Target) =>
          Object.entries(slots).find(([, s]) => s === t)?.[0] ?? t
        const left = occupant(a.a),
          right = occupant(a.b)
        slots[left] = a.b
        slots[right] = a.a
        const values = { ...f.values }
        delete values[a.a]
        delete values[a.b]
        if (f.values[a.a] !== undefined) values[a.b] = f.values[a.a]!
        if (f.values[a.b] !== undefined) values[a.a] = f.values[a.b]!
        f = {
          ...f,
          values,
          slots: Object.fromEntries(
            Object.entries(slots).filter(([e, s]) => e !== s),
          ),
        }
        break
      }
      case 'pointer':
        f = {
          ...f,
          pointers:
            a.target === null
              ? Object.fromEntries(
                  Object.entries(f.pointers).filter(
                    ([name]) => name !== a.name,
                  ),
                )
              : { ...f.pointers, [a.name]: a.target },
        }
        break
      case 'push':
      case 'enqueue': {
        const items = f.containers[a.container] ?? []
        f = {
          ...f,
          containers: {
            ...f.containers,
            [a.container]: [
              ...items.filter((i) => i.id !== a.id),
              { id: a.id, value: a.value },
            ],
          },
          removed: f.removed.filter((t) => t !== `item:${a.id}`),
          relayout: true,
        }
        break
      }
      case 'pop':
      case 'dequeue': {
        const items = f.containers[a.container] ?? []
        if (!items.length) throw new Error(`empty container ${a.container}`)
        const item = a.op === 'pop' ? items[items.length - 1]! : items[0]!
        f = {
          ...f,
          containers: {
            ...f.containers,
            [a.container]: a.op === 'pop' ? items.slice(0, -1) : items.slice(1),
          },
        }
        remove(
          Target.parse(
            `${a.container === 'frames' ? 'node' : 'item'}:${item.id}`,
          ),
        )
        break
      }
      case 'add':
        f = {
          ...f,
          added: [
            ...f.added,
            { ...a.element, ...(a.parent ? { parent: a.parent } : {}) },
          ],
          relayout: true,
        }
        break
      case 'remove':
        remove(a.target)
        break
      case 'token':
        f = {
          ...f,
          tokens: [
            ...f.tokens,
            {
              id: a.id,
              ...(a.label ? { label: a.label } : {}),
              path: [...a.path],
            },
          ],
        }
        break
      case 'annotate':
        f = { ...f, annotations: { ...f.annotations, [a.target]: a.text } }
        break
      case 'focus':
        f = { ...f, focus: a.target }
        break
    }
  }
  return f
}

const BASE: readonly ActionOp[] = [
  'highlight',
  'unhighlight',
  'hide',
  'reveal',
  'annotate',
  'focus',
]
function specTargets(ir: IR): string[] {
  switch (ir.type) {
    case 'graph':
      return [
        ...ir.nodes.map((n) => `node:${n.id}`),
        ...ir.edges.map((e) => `edge:${e.id}`),
        ...ir.groups.map((g) => `group:${g.id}`),
      ]
    case 'sequence':
      return [
        ...ir.participants.map((p) => `node:${p.id}`),
        ...ir.messages.map((m) => `msg:${m.id}`),
      ]
    case 'state':
      return [
        ...ir.states.map((s) => `node:${s.id}`),
        ...ir.transitions.map((t) => `edge:${t.id}`),
      ]
    case 'class':
      return [
        ...ir.classes.map((c) => `node:${c.id}`),
        ...ir.relations.map((r) => `edge:${r.id}`),
      ]
    case 'er':
      return [
        ...ir.entities.map((e) => `node:${e.id}`),
        ...ir.relationships.map((r) => `edge:${r.id}`),
      ]
    case 'timeline':
      return [
        ...ir.lanes.map((l) => `node:${l.id}`),
        ...ir.events.map((e) => `item:${e.id}`),
      ]
    default:
      return []
  }
}

/** Builds validated frame states, including frame zero; never mutates the IR or template seeds. */
export function buildFrames(
  ir: IR,
  animation: AnimationIR,
  options: AnimationOptions = {},
): FrameState[] {
  const anim = AnimationIR.parse(animation)
  const template =
    ir.type === 'template'
      ? options.templates?.getTemplate(ir.templateId)
      : undefined
  if (ir.type === 'template' && !template)
    throw new Error(`missing template ${ir.templateId}`)
  const props =
    template && ir.type === 'template'
      ? template.propsSchema.parse(ir.props)
      : undefined
  const targets = new Set(
    (template ? template.targets?.(props) ?? [] : specTargets(ir)).map((t) =>
      Target.parse(t),
    ),
  )
  const supported = template?.supportedActions ?? [
    ...BASE,
    ...(ir.type === 'graph' || ir.type === 'state' ? ['token' as const] : []),
  ]
  const seed = structuredClone(template?.initialFrame?.(props) ?? {})
  let frame = { ...emptyFrame(anim.initialHidden), ...seed }
  const resolves = (t: string) => {
    if (
      t !== 'all' &&
      (!targets.has(Target.parse(t)) || frame.removed.includes(t as Target))
    )
      throw new Error(`unknown or removed target ${t}`)
  }
  for (const t of anim.initialHidden) resolves(t)
  for (const t of Object.values(seed.pointers ?? {})) resolves(t)
  const check = () => {
    FrameState.parse(frame)
    if (template) {
      const current = projectTemplateFrame(props, frame, template.id)
      template.propsSchema.parse(current)
      const issues = template.checkInvariants?.(current) ?? []
      if (issues.length)
        throw new Error(`frame ${frame.step}: ${issues.join('; ')}`)
      if (template.targets) {
        targets.clear()
        for (const t of template.targets(current)) targets.add(Target.parse(t))
      }
    }
    for (const t of Object.values(frame.pointers)) resolves(t)
  }
  check()
  const frames = [frame]
  for (const step of anim.steps) {
    for (const a of step.actions) {
      if (!supported.includes(a.op))
        throw new Error(`unsupported action ${a.op}`)
      if ('target' in a && a.target !== null) resolves(a.target)
      if (a.op === 'swap') {
        resolves(a.a)
        resolves(a.b)
      }
      if ('container' in a && !(a.container in frame.containers))
        throw new Error(`unknown container ${a.container}`)
      if (a.op === 'token') for (const id of a.path) resolves(`edge:${id}`)
      if (a.op === 'add') {
        if ([...targets].some((t) => t.endsWith(`:${a.element.id}`)))
          throw new Error(`duplicate added id ${a.element.id}`)
        if (a.parent)
          resolves(
            ir.type === 'template' && ir.templateId === 'hash-table'
              ? `cell:buckets[${a.parent}]`
              : `node:${a.parent}`,
          )
        const item =
          ir.type === 'template' &&
          ['hash-table', 'cache', 'pipeline'].includes(ir.templateId)
        targets.add(Target.parse(`${item ? 'item' : 'node'}:${a.element.id}`))
        if (ir.type === 'template' && ir.templateId === 'cache')
          targets.add(Target.parse(`node:${a.element.id}`))
        if (a.parent && ir.type === 'template' && ir.templateId === 'tree')
          targets.add(Target.parse(`edge:${a.element.id}`))
        if (ir.type === 'template' && ir.templateId === 'linked-list') {
          targets.add(Target.parse(`edge:next-${a.element.id}`))
          if ((props as { doubly?: boolean }).doubly)
            targets.add(Target.parse(`edge:prev-${a.element.id}`))
        }
      }
      if (a.op === 'push' || a.op === 'enqueue')
        targets.add(
          Target.parse(`${a.container === 'frames' ? 'node' : 'item'}:${a.id}`),
        )
      // Resolve in action order: remove/pop cannot be targeted later in the same step.
      frame = apply({ ...frame, step: frame.step - 1 }, [a])
    }
    // One step, not one action: ephemeral state must aggregate within the step.
    frame = {
      ...apply(frames[frames.length - 1]!, step.actions),
      stepId: step.id,
      narration: step.narration,
      evidence: { ...step.evidence },
    }
    check()
    frames.push(frame)
  }
  return frames
}

export interface AnimationValidation {
  ok: boolean
  issues: ValidationIssue[]
  animation?: AnimationIR
  frames?: FrameState[]
}

/** Schema, target, renderer capability, every-frame invariants and grounded narration checks. */
export function validateAnimation(
  ir: IR,
  input: unknown,
  options: AnimationOptions = {},
): AnimationValidation {
  const issues: ValidationIssue[] = []
  const error = (code: string, message: string, elementId?: string) =>
    issues.push({
      layer: 'animation',
      severity: 'error',
      code,
      message,
      ...(elementId ? { elementId } : {}),
    })
  const parsed = AnimationIR.safeParse(input)
  if (!parsed.success) {
    error('animation-schema', parsed.error.message)
    return { ok: false, issues }
  }
  const animation = parsed.data
  if (!options.grounding)
    error(
      'animation-grounding-context',
      'Narration requires permitted section blocks',
    )
  else
    for (const step of animation.steps) {
      const result = ground(step.evidence, {
        ...options.grounding,
        label: step.narration,
      })
      if (result.status !== 'grounded')
        error(
          'animation-evidence',
          result.reason ?? 'Narration evidence is not grounded',
          step.id,
        )
      else step.evidence = result.evidence!
    }
  let frames: FrameState[] | undefined
  try {
    frames = buildFrames(ir, animation, options)
  } catch (e) {
    error('animation-frame', e instanceof Error ? e.message : String(e))
  }
  return issues.length
    ? { ok: false, issues }
    : { ok: true, issues, animation, frames }
}

/** The caller supplies the replay-capable repair port. Exactly one attempt, then static fallback. */
export async function validateAnimationWithRepair(
  ir: IR,
  input: unknown,
  options: AnimationOptions,
  repair: (input: unknown, issues: ValidationIssue[]) => Promise<unknown>,
): Promise<
  AnimationValidation & { repaired: boolean; staticFallback: boolean }
> {
  let result = validateAnimation(ir, input, options)
  if (result.ok) return { ...result, repaired: false, staticFallback: false }
  try {
    result = validateAnimation(ir, await repair(input, result.issues), options)
  } catch (e) {
    result = {
      ok: false,
      issues: [
        ...result.issues,
        {
          layer: 'animation',
          severity: 'error',
          code: 'animation-repair',
          message: e instanceof Error ? e.message : String(e),
        },
      ],
    }
  }
  return { ...result, repaired: true, staticFallback: !result.ok }
}
