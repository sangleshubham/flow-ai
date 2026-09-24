// @vitest-environment jsdom
import { make } from '@illus/core/testing'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  now: vi.fn(),
})
describe('every Illustrate pane state', () => {
  const expected = {
    idle: 'See what you’re reading',
    'indexing-required': 'Understand this book',
    waiting: 'Stay on this section to illustrate it',
    planning: 'Planning the visual…',
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
const s_intent = () => make.planItem({ planItemId: 'a' }).intent
describe('dwell countdown (ADR 0048)', () => {
  it('counts down and offers to illustrate now', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(10_000)
      const s = createPaneState()
      s.status = 'waiting'
      s.section = make.sectionNode()
      s.dwellUntil = 15_000
      const c = commands()
      render(<PaneContent state={s} commands={c} renderVisual={() => null} />)
      expect(screen.getByText('Starting in 5 s.')).toBeDefined()
      act(() => {
        vi.advanceTimersByTime(2_000)
      })
      expect(screen.getByText('Starting in 3 s.')).toBeDefined()
      fireEvent.click(screen.getByRole('button', { name: 'Illustrate now' }))
      expect(c.now).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
  it('titles the pane with the open section and keeps its path as a tooltip', () => {
    const s = createPaneState()
    s.section = make.sectionNode({ headingPath: ['5 Replication', '5.1 Leaders'] })
    render(<PaneContent state={s} commands={commands()} renderVisual={() => null} />)
    const title = screen.getByRole('heading', { level: 2 })
    expect(title.textContent).toBe('5.1 Leaders')
    expect(title.getAttribute('title')).toBe('5 Replication / 5.1 Leaders')
  })
})
describe('stage text, overview and caption', () => {
  const view = (fill: (s: ReturnType<typeof createPaneState>) => void) => {
    const s = createPaneState()
    s.items = [make.planItem({ planItemId: 'a', intent: 'Arch' })]
    s.selectedItem = 'a'
    fill(s)
    const ui = () => (
      <PaneContent
        state={s}
        commands={commands()}
        renderVisual={() => <p>v</p>}
      />
    )
    return { s, ui, ...render(ui()) }
  }
  it('shows the stage under the skeleton and updates it', () => {
    const { s, ui, rerender } = view((s) => {
      s.status = 'generating'
      s.stages = { a: 'extracting' }
    })
    expect(screen.getByText('Drawing the diagram…')).toBeDefined()
    s.stages = { a: 'animating' }
    rerender(ui())
    expect(screen.getByText('Adding animation…')).toBeDefined()
  })
  it('folds overview and caption under "About this diagram", collapsed', () => {
    view((s) => {
      s.status = 'ready'
      s.records = [make.visualRecord({ planItemId: 'a' })]
      s.overview = 'The overview'
      s.items = [make.planItem({ planItemId: 'a', caption: 'The caption' })]
    })
    const about = document.querySelector('details.illus-about')!
    expect(about.hasAttribute('open')).toBe(false)
    expect(about.textContent).toContain('The caption')
    expect(about.textContent).toContain('The overview')
    // One visual: no tab strip, the visual is a labelled group.
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('group', { name: s_intent() })).toBeDefined()
  })
  it('renders overview and caption only when present', () => {
    view((s) => {
      s.status = 'ready'
      s.records = [make.visualRecord({ planItemId: 'a' })]
      s.overview = 'The overview'
      s.items = [make.planItem({ planItemId: 'a', caption: 'The caption' })]
    })
    expect(screen.getByText('The overview')).toBeDefined()
    expect(screen.getByText('The caption')).toBeDefined()
    cleanup()
    view((s) => {
      s.status = 'ready'
      s.records = [make.visualRecord({ planItemId: 'a' })]
    })
    expect(document.querySelector('.illus-overview')).toBeNull()
    expect(document.querySelector('.illus-caption')).toBeNull()
  })
})
