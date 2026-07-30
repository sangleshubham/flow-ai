// Mermaid rendering (§10, §17): strict security level, theme variables from tokens, output sanitised with
// DOMPurify's SVG profile, then tagged with `data-ir-id` / `data-target` for evidence and animation.
import mermaid from 'mermaid'

import type { ThemeTokens } from '@illus/core'

import { sanitizeSvg } from '../sanitize.ts'
import { resolveTokens } from '../theme.ts'

import { ER_NO_TYPE, toMermaid } from './source.ts'
import type { MermaidIR } from './source.ts'

/** Mermaid's khroma needs plain colour strings, so tokens are resolved first. */
export function mermaidThemeVariables(tokens: ThemeTokens): Record<string, string | boolean> {
  const t = resolveTokens(tokens)
  return {
    darkMode: t.dark,
    background: t.bg,
    fontFamily: t.font,
    fontSize: '14px',
    primaryColor: t.bg,
    primaryTextColor: t.fg,
    primaryBorderColor: t.fg,
    secondaryColor: t.bg,
    tertiaryColor: t.bg,
    mainBkg: t.bg,
    nodeBorder: t.fg,
    lineColor: t.muted,
    textColor: t.fg,
    titleColor: t.fg,
    edgeLabelBackground: t.bg,
    labelBackgroundColor: t.bg,
    actorBkg: t.bg,
    actorBorder: t.fg,
    actorTextColor: t.fg,
    actorLineColor: t.line,
    signalColor: t.muted,
    signalTextColor: t.fg,
    labelBoxBkgColor: t.bg,
    labelBoxBorderColor: t.line,
    labelTextColor: t.fg,
    loopTextColor: t.fg,
    noteBkgColor: t.bg,
    noteTextColor: t.fg,
    noteBorderColor: t.line,
    activationBkgColor: t.bg,
    activationBorderColor: t.fg,
    stateBkg: t.bg,
    stateLabelColor: t.fg,
    transitionColor: t.muted,
    transitionLabelColor: t.fg,
    compositeBackground: t.bg,
    altBackground: t.bg,
    specialStateColor: t.fg,
    innerEndBackground: t.fg,
    classText: t.fg,
    attributeBackgroundColorOdd: t.bg,
    attributeBackgroundColorEven: t.bg,
  }
}

let queue: Promise<unknown> = Promise.resolve()
let counter = 0

/**
 * Renders an IR to a sanitised SVG string. Calls are serialised because `mermaid.initialize` is global.
 */
export function renderMermaidSvg(ir: MermaidIR, tokens: ThemeTokens): Promise<string> {
  const { source } = toMermaid(ir)
  const job = queue.then(async () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: mermaidThemeVariables(tokens),
      // SVG text labels: the SVG profile strips foreignObject, and exports stay self-contained.
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      sequence: { useMaxWidth: false },
      state: { useMaxWidth: false },
      class: { useMaxWidth: false },
      er: { useMaxWidth: false },
    })
    const { svg } = await mermaid.render(`illus-mmd-${++counter}`, source)
    return sanitizeSvg(svg)
  })
  queue = job.catch(() => undefined)
  return job
}

const tag = (el: Element | null | undefined, id: string, target: string, focusable: boolean) => {
  if (!el) return
  el.setAttribute('data-ir-id', id)
  el.setAttribute('data-target', target)
  el.classList.add('illus-el')
  if (focusable) el.setAttribute('tabindex', '0')
}

/** Node-like group whose Mermaid id is `<svgId>-<prefix>-<alias>-<n>`. */
function nodeGroup(root: Element, prefix: string, alias: string): Element | undefined {
  const re = new RegExp(`-${prefix}-${alias}-\\d+$`)
  return [...root.querySelectorAll('g.node[id]')].find((g) => re.test(g.id))
}

/**
 * Attaches IR ids to the Mermaid SVG inside `root` (§10). Positional mapping follows `toMermaid`'s
 * emission order: participants/states/classes/entities by alias, messages/transitions/relations by order.
 */
export function tagMermaid(root: Element, ir: MermaidIR): void {
  const { aliases } = toMermaid(ir)
  const alias = Object.fromEntries(Object.entries(aliases).map(([a, id]) => [id, a]))
  const svg = root.querySelector('svg')
  if (!svg) return
  // Natural size instead of Mermaid's width="100%"; the surface fits it to the pane.
  const vb = svg.viewBox.baseVal
  if (vb && vb.width) {
    svg.setAttribute('width', String(Math.ceil(vb.width)))
    svg.setAttribute('height', String(Math.ceil(vb.height)))
    svg.style.removeProperty('max-width')
  }
  svg.classList.add('illus-svg-mermaid')
  const edges = [...svg.querySelectorAll('path[data-et="edge"]')]
  const edgeLabel = (path: Element) => svg.querySelector(`g.label[data-id="${CSS.escape(path.getAttribute('data-id') ?? '')}"]`)?.closest('g.edgeLabel')

  switch (ir.type) {
    case 'sequence': {
      for (const p of ir.participants) {
        const a = alias[p.id]!
        tag(svg.querySelector(`g[data-et="participant"][data-id="${a}"]`), p.id, `node:${p.id}`, true)
        tag(svg.querySelector(`rect.actor-bottom[name="${a}"]`)?.parentElement, p.id, `node:${p.id}`, false)
        tag(svg.querySelector(`line[data-et="life-line"][data-id="${a}"]`), p.id, `node:${p.id}`, false)
      }
      const lines = [...svg.querySelectorAll('line[data-et="message"]')]
      const texts = [...svg.querySelectorAll('text.messageText')]
      ir.messages.forEach((m, i) => {
        tag(lines[i], m.id, `msg:${m.id}`, true)
        tag(texts[i], m.id, `msg:${m.id}`, false)
      })
      break
    }
    case 'state': {
      for (const s of ir.states) tag(nodeGroup(svg, 'state', alias[s.id]!), s.id, `node:${s.id}`, true)
      ir.transitions.forEach((t, i) => {
        const path = svg.querySelector(`path[data-et="edge"][data-id="edge${i}"]`)
        tag(path, t.id, `edge:${t.id}`, true)
        if (path) tag(edgeLabel(path), t.id, `edge:${t.id}`, false)
      })
      break
    }
    case 'class': {
      for (const c of ir.classes) {
        const g = nodeGroup(svg, 'classId', alias[c.id]!)
        tag(g, c.id, `node:${c.id}`, true)
        if (!g) continue
        const fields = [...g.querySelectorAll(':scope > g.members-group > g.label')]
        const methods = [...g.querySelectorAll(':scope > g.methods-group > g.label')]
        c.fields.forEach((_, i) => tag(fields[i], `${c.id}.f${i}`, `item:${c.id}.f${i}`, true))
        c.methods.forEach((_, i) => tag(methods[i], `${c.id}.m${i}`, `item:${c.id}.m${i}`, true))
      }
      ir.relations.forEach((r, i) => {
        tag(edges[i], r.id, `edge:${r.id}`, true)
        if (edges[i]) tag(edgeLabel(edges[i]!), r.id, `edge:${r.id}`, false)
      })
      break
    }
    case 'er': {
      for (const e of ir.entities) {
        const g = nodeGroup(svg, 'entity', alias[e.id]!)
        tag(g, e.id, `node:${e.id}`, true)
        if (!g) continue
        const names = [...g.querySelectorAll('g.label.attribute-name')]
        const types = [...g.querySelectorAll('g.label.attribute-type')]
        e.attributes.forEach((a, i) => {
          tag(names[i], `${e.id}.a${i}`, `item:${e.id}.a${i}`, true)
          tag(types[i], `${e.id}.a${i}`, `item:${e.id}.a${i}`, false)
          if (!a.type) types[i]?.querySelectorAll('tspan').forEach((t) => t.textContent === ER_NO_TYPE && (t.textContent = ''))
        })
      }
      ir.relationships.forEach((r, i) => {
        tag(edges[i], r.id, `edge:${r.id}`, true)
        if (edges[i]) tag(edgeLabel(edges[i]!), r.id, `edge:${r.id}`, false)
      })
      break
    }
  }
}
