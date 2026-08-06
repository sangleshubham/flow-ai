// @vitest-environment jsdom
// Every template renders its worked example through W4's VisualView and chrome, and honours FrameState.
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { emptyFrame } from '@illus/core'
import type { FrameState, TemplateIR } from '@illus/core'
import { make } from '@illus/core/testing'

import { VisualView } from '../../VisualView.tsx'
import { exampleIR, listTemplates, templateRegistry } from '../index.ts'

const theme = make.themeTokens()
afterEach(cleanup)

async function draw(ir: TemplateIR, frame?: FrameState) {
  const { container } = render(<VisualView spec={{ ir, groundingScore: 1 }} theme={theme} templates={templateRegistry} {...(frame ? { frame } : {})} />)
  await waitFor(() => expect(container.querySelector('.illus-view')!.getAttribute('data-ready')).toBe('true'))
  return container
}

describe.each(listTemplates().map((t) => [t.id, t] as const))('%s', (_, t) => {
  it('renders its example inside the chrome, with ids, targets and evidence', async () => {
    const c = await draw(exampleIR(t))
    expect(c.querySelector('.illus-note')).toBeNull()
    expect(c.querySelector('[data-badge="kind"]')!.textContent).toBe(t.id)
    const svg = c.querySelector('.illus-canvas svg')!
    expect(svg.getAttribute('data-illus-frame')).toBe('self')
    const ids = new Set([...svg.querySelectorAll('[data-ir-id]')].map((e) => e.getAttribute('data-ir-id')))
    for (const e of t.exampleEvidence) expect(ids, e.path).toContain(e.path)
    const drawn = new Set([...svg.querySelectorAll('[data-target]')].map((e) => e.getAttribute('data-target')))
    for (const target of t.targets(t.example)) expect(drawn, target).toContain(target)
  })

  it('applies highlights, hides, values, pointers and annotations from the frame', async () => {
    const [a, b] = t.targets(t.example)
    const frame: FrameState = {
      ...emptyFrame(b ? [b as never] : []),
      step: 1,
      highlights: { [a!]: 'focus' },
      pointers: { zz: a as never },
      values: { [a!]: 42 },
      annotations: { [a!]: 'note here' },
    }
    const c = await draw(exampleIR(t), frame)
    const svg = c.querySelector('.illus-canvas svg')!
    const el = svg.querySelector(`[data-target="${a}"]`)!
    expect(el.classList).toContain('illus-tone-focus')
    if (b) expect(svg.querySelector(`[data-target="${b}"]`)!.classList).toContain('illus-hidden')
    expect(svg.querySelector(`[data-annotation-for="${a}"]`)!.textContent).toBe('note here')
    expect(svg.querySelector(`[data-pointer][data-for="${a}"]`)!.textContent).toContain('zz')
    if (t.supportedActions.includes('set')) expect(svg.textContent).toContain('42')
  })
})
