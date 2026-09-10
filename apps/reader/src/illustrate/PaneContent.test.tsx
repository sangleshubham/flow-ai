// @vitest-environment jsdom
import { make } from '@illus/core/testing'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PaneContent, QualityWarning } from './PaneContent'
import type { PaneCommands } from './PaneContent'
import { createPaneState, PANE_STATES } from './state'

afterEach(cleanup)
const commands = (): PaneCommands => ({
  close: vi.fn(),
  pin: vi.fn(),
  approve: vi.fn(),
  retry: vi.fn(),
  force: vi.fn(),
  report: vi.fn(),
  previous: vi.fn(),
  selection: vi.fn(),
  select: vi.fn(),
})
describe('every Illustrate pane state', () => {
  const expected = {
    idle: 'See what you’re reading',
    'indexing-required': 'Understand this book',
    planning: 'Reading this section…',
    generating: 'Architecture',
    ready: 'saved visual',
    'no-visual': 'No diagram needed',
    error: 'Couldn’t finish this illustration',
    'plan-limit': 'Plan requests are paused',
    'signin-required': 'Connect your ChatGPT account',
    offline: 'You’re offline',
  }
  for (const status of PANE_STATES)
    it(`renders ${status} and cached visuals remain available during interruptions`, () => {
      const s = createPaneState()
      s.status = status
      s.section = make.sectionNode()
      s.estimate = { requests: 2, tokens: 500 }
      s.reason = 'Narrative only'
      s.message = 'Test error'
      s.items = [make.planItem({ intent: 'Architecture' })]
      s.records = [make.visualRecord()]
      s.selectedItem = s.items[0]!.planItemId
      render(
        <PaneContent
          state={s}
          commands={commands()}
          renderVisual={() => <p>saved visual</p>}
        />,
      )
      expect(
        screen
          .getByRole('region', { name: 'Illustrate' })
          .getAttribute('data-state'),
      ).toBe(status)
      expect(screen.getAllByText(expected[status]).length).toBeGreaterThan(0)
      expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
      if (status === 'signin-required')
        expect(
          screen
            .getByRole('link', { name: 'Continue with ChatGPT' })
            .getAttribute('href'),
        ).toBe('/auth/chatgpt/start')
      if (
        status === 'offline' ||
        status === 'plan-limit' ||
        status === 'signin-required'
      )
        expect(screen.getByText('saved visual')).toBeDefined()
    })
  it('offers retry, report, force, selection, pin and close through reachable buttons', () => {
    const s = createPaneState()
    s.status = 'error'
    const c = commands()
    const view = render(
      <PaneContent state={s} commands={c} renderVisual={() => null} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(c.retry).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Report' }))
    expect(c.report).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Pin visual' }))
    expect(c.pin).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Close Illustrate' }))
    expect(c.close).toHaveBeenCalledOnce()
    s.status = 'no-visual'
    s.selection = { cfiRange: 'cfi', text: 'selected', blockIds: ['block'] }
    view.rerender(
      <PaneContent state={s} commands={c} renderVisual={() => null} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Illustrate anyway' }))
    expect(c.force).toHaveBeenCalledOnce()
    fireEvent.click(
      screen.getByRole('button', { name: 'Illustrate selection' }),
    )
    expect(c.selection).toHaveBeenCalledOnce()
  })
  it('supports arrow keys, Home and End on the visual tablist', () => {
    const s = createPaneState()
    s.status = 'ready'
    s.items = [
      make.planItem({ planItemId: 'a', intent: 'First' }),
      make.planItem({ planItemId: 'b', intent: 'Second' }),
    ]
    s.records = [make.visualRecord({ planItemId: 'a' })]
    s.selectedItem = 'a'
    const c = commands()
    render(<PaneContent state={s} commands={c} renderVisual={() => null} />)
    const first = screen.getByRole('tab', { name: 'First' })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(c.select).toHaveBeenCalledWith('b')
    expect(document.activeElement).toBe(
      screen.getByRole('tab', { name: 'Second' }),
    )
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(document.activeElement).toBe(first)
  })
  it('says when ChatGPT sign-in is not configured instead of offering the sign-in link', () => {
    const s = createPaneState()
    s.status = 'signin-required'
    s.signinConfigured = false
    render(
      <PaneContent state={s} commands={commands()} renderVisual={() => null} />,
    )
    expect(screen.getByText('ChatGPT sign-in is not configured')).toBeDefined()
    expect(
      screen.queryByRole('link', { name: 'Continue with ChatGPT' }),
    ).toBeNull()
  })
  it('shows concept-model catch-up progress under the generating item', () => {
    const s = createPaneState()
    s.status = 'generating'
    s.items = [make.planItem({ planItemId: 'a', intent: 'Raft roles' })]
    s.catchingUp = { a: 3 }
    render(
      <PaneContent state={s} commands={commands()} renderVisual={() => null} />,
    )
    expect(
      screen.getByText('Catching up the concept model: 3 sections'),
    ).toBeDefined()
  })
})
describe('quality warning badge (§16 L4/L5)', () => {
  const critic = {
    pass: false,
    scores: { legibility: 2, intentMatch: 4, clutter: 3 },
    issues: [{ kind: 'overlap', note: 'Labels overlap' }],
  } as const
  const render_ = {
    layer: 'render',
    severity: 'warning',
    code: 'label-overlap',
    message: 'Two labels overlap',
  } as const
  it('flags a failing critic report with its notes and leftover render findings', () => {
    const r = make.visualRecord()
    r.critic = structuredClone(critic) as never
    r.validation.issues = [render_]
    render(<QualityWarning record={r} />)
    expect(screen.getByText(/Quality review flagged this visual/)).toBeDefined()
    expect(screen.getByRole('img', { name: 'Warning' })).toBeDefined()
    expect(screen.getByText('Labels overlap')).toBeDefined()
    expect(screen.getByText('Two labels overlap')).toBeDefined()
  })
  it('flags render-check warnings when the critic passed or did not run', () => {
    const r = make.visualRecord()
    r.validation.issues = [render_]
    render(<QualityWarning record={r} />)
    expect(screen.getByText(/Layout checks found issues/)).toBeDefined()
  })
  it('stays hidden for a clean visual and sits above the visual in the pane', () => {
    const clean = make.visualRecord()
    const { container } = render(<QualityWarning record={clean} />)
    expect(container.innerHTML).toBe('')
    cleanup()
    const s = createPaneState()
    s.status = 'ready'
    s.items = [make.planItem({ planItemId: 'a' })]
    s.selectedItem = 'a'
    const r = make.visualRecord({ planItemId: 'a' })
    r.critic = structuredClone(critic) as never
    s.records = [r]
    render(
      <PaneContent
        state={s}
        commands={commands()}
        renderVisual={() => <p>saved visual</p>}
      />,
    )
    expect(screen.getByTestId('quality-warning')).toBeDefined()
    expect(screen.getByText('saved visual')).toBeDefined()
  })
})
