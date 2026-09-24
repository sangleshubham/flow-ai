// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import ELK from 'elkjs/lib/elk.bundled.js'
import { afterEach, describe, expect, it } from 'vitest'

import { GRAPH_ICON_NAMES } from '@illus/core'
import type { LayoutGraphFn } from '@illus/core'
import { make } from '@illus/core/testing'

import { ICON_SVGS } from '../src/graph/icons.generated.ts'
import { hasIcon, ICON_BAND, nodeSize } from '../src/graph/measure.ts'
import { runElkLayout, VisualView } from '../src/index.ts'

const elk = new ELK()
const layout: LayoutGraphFn = (input) => runElkLayout(elk, input)
const theme = make.themeTokens()
const measure = (text: string) => text.length * 7

afterEach(cleanup)

describe('graph icons (ADR 0049)', () => {
  it('has exactly one glyph per catalog name, made of plain shapes', () => {
    expect(Object.keys(ICON_SVGS).sort()).toEqual([...GRAPH_ICON_NAMES].sort())
    for (const [name, icon] of Object.entries(ICON_SVGS)) {
      expect(icon.viewBox, name).toMatch(/^\d+ \d+ \d+ \d+$/)
      expect(icon.body, name).not.toMatch(/<(script|style|image|use|foreignObject|a)\b|\son\w+=|href|<rect\b/i)
    }
  })

  it('draws generic icons in currentColor so they follow the theme', () => {
    expect(ICON_SVGS.database!.body).toContain('currentColor')
    expect(ICON_SVGS['aws-lambda']!.body).not.toContain('currentColor')
  })

  it('makes room for an icon above the label, except on decisions and notes', () => {
    const base = make.graphIR().nodes[1]!
    expect(nodeSize({ ...base, icon: 'server' }, measure).height).toBe(nodeSize(base, measure).height + ICON_BAND)
    expect(hasIcon({ ...base, shape: 'decision', icon: 'server' })).toBe(false)
    expect(hasIcon({ ...base, icon: 'not-an-icon' })).toBe(false)
  })

  it('renders node and group icons and colour hooks', async () => {
    const ir = make.graphIR()
    const withIcons = {
      ...ir,
      nodes: ir.nodes.map((n) => (n.id === 'log' ? { ...n, icon: 'logs', color: 'green' as const } : n.id === 'client' ? { ...n, icon: 'user' } : n)),
      groups: [{ id: 'cluster', label: 'Cluster', icon: 'servers', color: 'blue' as const, evidence: ir.nodes[3]!.evidence }],
    }
    withIcons.nodes[3] = { ...withIcons.nodes[3]!, group: 'cluster' }
    const { container } = render(<VisualView spec={{ ir: withIcons }} theme={theme} layoutGraph={layout} />)
    await waitFor(() => expect(container.querySelector('.illus-view')!.getAttribute('data-ready')).toBe('true'))
    const log = container.querySelector('[data-target="node:log"]')!
    expect(log.getAttribute('data-color')).toBe('green')
    expect(log.querySelector('svg.illus-icon')).not.toBeNull()
    // An actor with an icon is a box: no stick figure.
    const client = container.querySelector('[data-target="node:client"]')!
    expect(client.querySelector('svg.illus-icon')).not.toBeNull()
    expect(client.querySelector('.illus-glyph')).toBeNull()
    expect(container.querySelector('[data-target="node:leader"] svg.illus-icon')).toBeNull()
    const group = container.querySelector('[data-target="group:cluster"]')!
    expect(group.getAttribute('data-color')).toBe('blue')
    expect(group.querySelector('svg.illus-icon')).not.toBeNull()
  })
})
