// IR → Mermaid source for the sequence, state, class and ER renderers (§8 stage 3, §10). Pure.
//
// Mermaid ids are positional aliases (`n0`, `n1`, … in IR order) instead of the raw IR ids: stateDiagram
// rejects hyphens in ids and every diagram type has reserved words (`end`, `state`, `class`…). The
// post-processor maps aliases back to IR ids through `aliases` (ADR 0006).
import type { ClassIR, ClassRelation, ErCardinality, ErIR, SequenceIR, StateIR } from '@illus/core'

export type MermaidIR = SequenceIR | StateIR | ClassIR | ErIR

export interface MermaidSource {
  source: string
  /** Mermaid alias → IR id of the node-like element (participant, state, class, entity). */
  aliases: Record<string, string>
}

/**
 * Text for diagrams that render labels as plain text (state, class, ER): only characters the grammar
 * reacts to are swapped for look-alikes. `;` separates statements, `"` ends quoted labels, `{}` open
 * and close class bodies, `~` marks generics.
 */
export function plain(s: string): string {
  return s
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/"/g, '”')
    .replace(/;/g, ';')
    .replace(/\{/g, '❴')
    .replace(/\}/g, '❵')
    .replace(/~/g, '∼')
    .trim()
}

/** Sequence-diagram text: everything outside a small safe set becomes a Mermaid entity code (`#60;`). */
export function seqText(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/[^A-Za-z0-9 _.,'\-+*/=!?@$]/g, (c) => `#${c.codePointAt(0)};`)
}

function aliasMap<T extends { id: string }>(items: readonly T[]): { aliases: Record<string, string>; of: (id: string) => string } {
  const byId = new Map(items.map((it, i) => [it.id, `n${i}`]))
  return {
    aliases: Object.fromEntries(items.map((it, i) => [`n${i}`, it.id])),
    // Unknown ids (dangling references the validator should have dropped) get an inert alias.
    of: (id) => byId.get(id) ?? `x_${id.replace(/[^A-Za-z0-9_]/g, '_')}`,
  }
}

const SEQ_ARROW = { sync: '->>', async: '-)', reply: '-->>' } as const

function sequence(ir: SequenceIR): MermaidSource {
  const { aliases, of } = aliasMap(ir.participants)
  const lines = ['sequenceDiagram']
  for (const p of ir.participants) lines.push(`  participant ${of(p.id)} as ${seqText(p.label)}`)
  for (const m of ir.messages) lines.push(`  ${of(m.from)}${SEQ_ARROW[m.kind]}${of(m.to)}: ${seqText(m.label)}`)
  return { source: lines.join('\n'), aliases }
}

/** Transitions are emitted first so transition k is Mermaid's `edge${k}` (start/end arrows follow). */
function state(ir: StateIR): MermaidSource {
  const { aliases, of } = aliasMap(ir.states)
  const lines = ['stateDiagram-v2']
  for (const s of ir.states) lines.push(`  state "${plain(s.label)}" as ${of(s.id)}`)
  for (const t of ir.transitions) {
    const label = plain(t.guard ? `${t.event} [${t.guard}]` : t.event)
    lines.push(`  ${of(t.from)} --> ${of(t.to)} : ${label}`)
  }
  lines.push(`  [*] --> ${of(ir.initial)}`)
  for (const f of ir.final) lines.push(`  ${of(f)} --> [*]`)
  return { source: lines.join('\n'), aliases }
}

const STEREOTYPE = { interface: 'interface', abstract: 'abstract', enumeration: 'enumeration', service: 'service' } as const

/** Relation syntax, written `from <arrow> to` (inheritance and realization point at `to`). */
const CLASS_ARROW: Record<ClassRelation['kind'], { arrow: string; reversed: boolean }> = {
  inheritance: { arrow: '<|--', reversed: true },
  realization: { arrow: '<|..', reversed: true },
  composition: { arrow: '*--', reversed: false },
  aggregation: { arrow: 'o--', reversed: false },
  association: { arrow: '-->', reversed: false },
  dependency: { arrow: '..>', reversed: false },
}

/** A field must not look like a method to Mermaid, so parentheses become brackets. */
const fieldText = (s: string) => plain(s).replace(/\(/g, '[').replace(/\)/g, ']')

function classDiagram(ir: ClassIR): MermaidSource {
  const { aliases, of } = aliasMap(ir.classes)
  const lines = ['classDiagram']
  for (const c of ir.classes) {
    lines.push(`  class ${of(c.id)}["${plain(c.label)}"] {`)
    if (c.stereotype) lines.push(`    <<${STEREOTYPE[c.stereotype]}>>`)
    for (const f of c.fields) {
      const typed = f.type ? `${f.name}: ${f.type}` : f.name
      lines.push(`    ${f.visibility ?? ''}${fieldText(typed)}${f.isStatic ? '$' : ''}`)
    }
    for (const m of c.methods) {
      const params = m.params ? fieldText(m.params) : ''
      const ret = m.returns ? ` ${fieldText(m.returns)}` : ''
      const classifier = m.isAbstract ? '*' : m.isStatic ? '$' : ''
      lines.push(`    ${m.visibility ?? ''}${fieldText(m.name)}(${params})${ret}${classifier}`)
    }
    lines.push('  }')
  }
  for (const r of ir.relations) {
    const { arrow, reversed } = CLASS_ARROW[r.kind]
    const [a, b] = reversed ? [r.to, r.from] : [r.from, r.to]
    const [ca, cb] = reversed ? [r.toCardinality, r.fromCardinality] : [r.fromCardinality, r.toCardinality]
    const left = ca ? ` "${ca}"` : ''
    const right = cb ? ` "${cb}"` : ''
    const label = r.label ? ` : ${plain(r.label)}` : ''
    lines.push(`  ${of(a)}${left} ${arrow}${right} ${of(b)}${label}`)
  }
  return { source: lines.join('\n'), aliases }
}

const ER_LEFT: Record<ErCardinality, string> = {
  'zero-or-one': '|o',
  'exactly-one': '||',
  'zero-or-more': '}o',
  'one-or-more': '}|',
}
const ER_RIGHT: Record<ErCardinality, string> = {
  'zero-or-one': 'o|',
  'exactly-one': '||',
  'zero-or-more': 'o{',
  'one-or-more': '|{',
}
/** ER attribute types and names must be identifiers; a missing type renders as `_` (blanked after render). */
const ident = (s: string) => s.replace(/[^A-Za-z0-9_\-[\]()]/g, '_').replace(/^[^A-Za-z_]/, '_$&')
export const ER_NO_TYPE = '_'

function er(ir: ErIR): MermaidSource {
  const { aliases, of } = aliasMap(ir.entities)
  const lines = ['erDiagram']
  for (const e of ir.entities) {
    lines.push(`  ${of(e.id)}["${plain(e.label)}"] {`)
    for (const a of e.attributes) lines.push(`    ${a.type ? ident(a.type) : ER_NO_TYPE} ${ident(a.name)}${a.key ? ` ${a.key}` : ''}`)
    lines.push('  }')
  }
  for (const r of ir.relationships) {
    const line = r.identifying ? '--' : '..'
    lines.push(`  ${of(r.from)} ${ER_LEFT[r.fromCardinality]}${line}${ER_RIGHT[r.toCardinality]} ${of(r.to)} : "${plain(r.label)}"`)
  }
  return { source: lines.join('\n'), aliases }
}

/** Mermaid source for one IR, plus the alias map the post-processor needs. */
export function toMermaid(ir: MermaidIR): MermaidSource {
  switch (ir.type) {
    case 'sequence':
      return sequence(ir)
    case 'state':
      return state(ir)
    case 'class':
      return classDiagram(ir)
    case 'er':
      return er(ir)
  }
}
