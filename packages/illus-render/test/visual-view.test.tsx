// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ELK from 'elkjs/lib/elk.bundled.js'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LayoutGraphFn, TemplateRegistry } from '@illus/core'
import { make, Q } from '@illus/core/testing'

import { runElkLayout, VisualView } from '../src/index.ts'
import type { RenderTemplate, TemplateViewProps } from '../src/index.ts'

const elk = new ELK()
const layout: LayoutGraphFn = (input) => runElkLayout(elk, input)
const theme = make.themeTokens()

afterEach(cleanup)

const ready = (c: HTMLElement) => waitFor(() => expect(c.querySelector('.illus-view')!.getAttribute('data-ready')).toBe('true'))

describe('VisualView chrome', () => {
  it('shows title, kind and grounding badges and the theme variables', async () => {
    const { container } = render(<VisualView spec={{ ir: make.graphIR(), groundingScore: 0.923 }} theme={theme} layoutGraph={layout} />)
    await ready(container)
    expect(screen.getByRole('heading').textContent).toBe('Log replication')
    expect(container.querySelector('[data-badge="kind"]')!.textContent).toBe('graph')
    expect(container.querySelector('[data-badge="grounding"]')!.textContent).toBe('92% grounded')
    expect((container.querySelector('.illus-view') as HTMLElement).style.getPropertyValue('--illus-accent')).toBe(theme.accent)
  })

  it('always marks timelines simulated and HTML unverified', async () => {
    const t = render(<VisualView spec={{ ir: make.timelineIR() }} theme={theme} />)
    expect(t.container.querySelector('[data-badge="simulated"]')).not.toBeNull()
    t.unmount()
    const h = render(<VisualView spec={{ ir: make.htmlIR() }} theme={theme} flags={{ htmlFallback: true }} />)
    expect(h.container.querySelector('[data-badge="unverified"]')).not.toBeNull()
    const iframe = h.container.querySelector('iframe')!
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('shows the legend only for concept models', async () => {
    const { container, rerender } = render(<VisualView spec={{ ir: make.timelineIR() }} theme={theme} />)
    expect(container.querySelector('[data-legend]')).toBeNull()
    rerender(<VisualView spec={{ ir: make.timelineIR(), newIds: ['a3'] }} theme={theme} />)
    expect(container.querySelector('[data-legend]')).not.toBeNull()
  })
})

describe('graph rendering in VisualView', () => {
  it('renders every node and edge with data-ir-id and reports the layout', async () => {
    const onLayout = vi.fn()
    const { container } = render(<VisualView spec={{ ir: make.graphIR() }} theme={theme} layoutGraph={layout} onLayout={onLayout} />)
    await ready(container)
    for (const id of ['client', 'leader', 'log', 'follower', 'e1', 'e2', 'e3', 'e4']) expect(container.querySelector(`[data-ir-id="${id}"]`)).not.toBeNull()
    expect(container.querySelector('[data-target="node:log"]')!.getAttribute('data-shape')).toBe('store')
    expect(onLayout).toHaveBeenCalledTimes(1)
  })

  it('skips layout when a cached layout fits', async () => {
    const ir = make.graphIR()
    const fn = vi.fn(layout)
    const first = render(<VisualView spec={{ ir }} theme={theme} layoutGraph={fn} onLayout={() => undefined} />)
    await ready(first.container)
    const cached = await fn.mock.results[0]!.value
    first.unmount()
    const spy = vi.fn(layout)
    const { container } = render(<VisualView spec={{ ir, layout: cached }} theme={theme} layoutGraph={spy} />)
    await ready(container)
    expect(spy).not.toHaveBeenCalled()
  })

  it('fires evidence callbacks on hover and click', async () => {
    const hover = vi.fn()
    const click = vi.fn()
    const { container } = render(<VisualView spec={{ ir: make.graphIR() }} theme={theme} layoutGraph={layout} onEvidenceHover={hover} onEvidenceClick={click} />)
    await ready(container)
    const edge = container.querySelector('[data-ir-id="e3"] path')!
    fireEvent.pointerMove(edge)
    fireEvent.click(edge)
    expect(hover).toHaveBeenLastCalledWith({ irId: 'e3', target: 'edge:e3', label: 'AppendEntries', evidence: Q.appendEntries })
    expect(click).toHaveBeenCalledWith(expect.objectContaining({ irId: 'e3', evidence: Q.appendEntries }))
    fireEvent.pointerLeave(container.querySelector('.illus-surface')!)
    expect(hover).toHaveBeenLastCalledWith(null)
  })

  it('applies frame classes and re-lays out with added nodes', async () => {
    const fn = vi.fn(layout)
    const frame = make.frameState({ highlights: { 'node:client': 'focus' }, hidden: ['node:follower'] })
    const { container, rerender } = render(<VisualView spec={{ ir: make.graphIR() }} frame={frame} theme={theme} layoutGraph={fn} />)
    await ready(container)
    expect(container.querySelector('[data-target="node:client"]')!.classList.contains('illus-tone-focus')).toBe(true)
    expect(container.querySelector('[data-target="node:follower"]')!.classList.contains('illus-hidden')).toBe(true)
    await act(async () => {
      rerender(
        <VisualView spec={{ ir: make.graphIR() }} frame={{ ...frame, added: [{ id: 'f2', label: 'Follower 2', parent: 'leader' }], relayout: true }} theme={theme} layoutGraph={fn} />,
      )
    })
    await waitFor(() => expect(container.querySelector('[data-target="node:f2"]')).not.toBeNull())
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn.mock.calls[1]![0].hints).toBeDefined()
  })
})

describe('template dispatch', () => {
  it('validates props with the template schema and renders its component', async () => {
    const Component = ({ props, onReady }: TemplateViewProps<{ values: number[] }>) => {
      useEffect(() => onReady?.(), [])
      return (
        <svg data-illus-frame="self">
          {props.values.map((v, i) => (
            <text key={i} data-ir-id="values" data-target={`cell:arr[${i}]`}>
              {v}
            </text>
          ))}
        </svg>
      )
    }
    const array = {
      id: 'array',
      description: '',
      whenToUse: '',
      propsSchema: { safeParse: (p: unknown) => ({ success: true, data: p }) },
      example: { values: [1] },
      supportedActions: [],
      layout: () => null,
      Component,
    } as unknown as RenderTemplate
    const registry: TemplateRegistry<RenderTemplate> = { getTemplate: (id) => (id === 'array' ? array : undefined), listTemplates: () => [array] }
    const { container } = render(<VisualView spec={{ ir: make.templateIR() }} theme={theme} templates={registry} />)
    await ready(container)
    expect(container.querySelectorAll('[data-target^="cell:arr"]')).toHaveLength(3)
    expect(container.querySelector('[data-badge="kind"]')!.textContent).toBe('array')
  })
})
