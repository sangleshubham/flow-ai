// Addressable elements of an IR and how a FrameState applies to one of them (§10 evidence, §11 frames).
//
// Every rendered element carries `data-ir-id` (its id below) and `data-target` (`kind:id`, the §11
// Target string animations address). Ids without one in the IR are derived: class members
// `${classId}.f${i}` / `.m${i}`, ER attributes `${entityId}.a${i}`, chart series `series-${i}`, math terms
// `term-${i}`, template elements by their evidence path.
import type { Evidence, FrameState, HighlightTone, IR } from '@illus/core'

export type ElementKind = 'node' | 'edge' | 'group' | 'msg' | 'item'

export interface IrElement {
  kind: ElementKind
  id: string
  target: string
  label: string
  evidence?: Evidence
}

const el = (kind: ElementKind, id: string, label: string, evidence?: Evidence): IrElement => ({
  kind,
  id,
  target: `${kind}:${id}`,
  label,
  ...(evidence ? { evidence } : {}),
})

/** Every addressable element of an IR, in render order. */
export function irElements(ir: IR): IrElement[] {
  switch (ir.type) {
    case 'graph':
      return [
        ...ir.nodes.map((n) => el('node', n.id, n.label, n.evidence)),
        ...ir.edges.map((e) => el('edge', e.id, e.label ?? '', e.evidence)),
        ...ir.groups.map((g) => el('group', g.id, g.label, g.evidence)),
      ]
    case 'sequence':
      return [
        ...ir.participants.map((p) => el('node', p.id, p.label, p.evidence)),
        ...ir.messages.map((m) => el('msg', m.id, m.label, m.evidence)),
      ]
    case 'state':
      return [
        ...ir.states.map((s) => el('node', s.id, s.label, s.evidence)),
        ...ir.transitions.map((t) => el('edge', t.id, t.event, t.evidence)),
      ]
    case 'class':
      return [
        ...ir.classes.flatMap((c) => [
          el('node', c.id, c.label, c.evidence),
          ...c.fields.map((f, i) => el('item', `${c.id}.f${i}`, f.name, f.evidence)),
          ...c.methods.map((m, i) => el('item', `${c.id}.m${i}`, m.name, m.evidence)),
        ]),
        ...ir.relations.map((r) => el('edge', r.id, r.label ?? r.kind, r.evidence)),
      ]
    case 'er':
      return [
        ...ir.entities.flatMap((e) => [
          el('node', e.id, e.label, e.evidence),
          ...e.attributes.map((a, i) => el('item', `${e.id}.a${i}`, a.name, a.evidence)),
        ]),
        ...ir.relationships.map((r) => el('edge', r.id, r.label, r.evidence)),
      ]
    case 'template':
      return ir.evidence.map((e) => el('item', e.path, e.path, e.evidence))
    case 'chart':
      return ir.series.map((s, i) => el('item', `series-${i}`, s.name, s.evidence))
    case 'math':
      return ir.terms.map((t, i) => el('item', `term-${i}`, t.symbol, t.evidence))
    case 'timeline':
      return [...ir.lanes.map((l) => el('group', l.id, l.label)), ...ir.events.map((e) => el('node', e.id, e.label, e.evidence))]
    case 'html':
      return []
  }
}

/** `data-ir-id` → element, for evidence hover and click. */
export function evidenceIndex(ir: IR): Map<string, IrElement> {
  const map = new Map<string, IrElement>()
  for (const e of irElements(ir)) if (!map.has(e.id)) map.set(e.id, e)
  return map
}

export interface ElementFrameState {
  hidden: boolean
  removed: boolean
  tone?: HighlightTone
  value?: string | number
  annotation?: string
  /** Names of the pointers aimed at this element (i, j, head…). */
  pointers: string[]
}

/** How one frame applies to one target (§11 FrameState). */
export function elementFrame(frame: FrameState | undefined, target: string): ElementFrameState {
  if (!frame) return { hidden: false, removed: false, pointers: [] }
  const out: ElementFrameState = {
    hidden: frame.hidden.includes(target as never),
    removed: frame.removed.includes(target as never),
    pointers: Object.entries(frame.pointers)
      .filter(([, t]) => t === target)
      .map(([name]) => name),
  }
  const tone = frame.highlights[target]
  if (tone) out.tone = tone
  const value = frame.values[target]
  if (value !== undefined) out.value = value
  const annotation = frame.annotations[target]
  if (annotation) out.annotation = annotation
  return out
}

/** CSS classes for a frame state; shared by React renderers and the Mermaid/Vega post-processors. */
export function frameClasses(s: ElementFrameState): string[] {
  const c: string[] = []
  if (s.hidden) c.push('illus-hidden')
  if (s.removed) c.push('illus-removed')
  if (s.tone) c.push(`illus-tone-${s.tone}`)
  return c
}
