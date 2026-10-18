// @vitest-environment jsdom
import { make } from '@illus/core/testing'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
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
  bookConfirm: vi.fn(),
  bookStart: vi.fn(),
  bookCancel: vi.fn(),
  bookPause: vi.fn(),
  bookResume: vi.fn(),
})
describe('every Illustrate pane state', () => {
  it('labels the fallback as a local pause and explains that Retry checks again', () => {
    const s = createPaneState()
    s.status = 'plan-limit'
    s.usage = { used5h: 7, usedDay: 9, pausedUntil: Date.now() + 1_800_000 }
    const c = commands()
    render(<PaneContent state={s} commands={c} renderVisual={() => null} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Local pause until')
    expect(alert.textContent).not.toContain('Resets')
    expect(alert.textContent).toContain('Retry checks your access again')
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(c.retry).toHaveBeenCalledOnce()
  })
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
describe('item previews (ADR 0054)', () => {
  it('draws a preview with its stage line and no quality badge; a stored record wins', () => {
    const s = createPaneState()
    s.status = 'ready'
    s.items = [make.planItem({ planItemId: 'a' })]
    s.selectedItem = 'a'
    s.stages = { a: 'animating' }
    const preview = make.visualRecord({ planItemId: 'a' })
    preview.critic = {
      pass: false,
      scores: { legibility: 2, intentMatch: 4, clutter: 3 },
      issues: [{ kind: 'overlap', note: 'Labels overlap' }],
    } as never
    s.previews = { a: preview }
    const { rerender } = render(
      <PaneContent
        state={s}
        commands={commands()}
        renderVisual={(r) => <p>{r === preview ? 'preview' : 'stored'}</p>}
      />,
    )
    expect(screen.getByText('preview')).toBeDefined()
    expect(screen.getByText('Adding animation…')).toBeDefined()
    expect(screen.queryByTestId('quality-warning')).toBeNull()
    s.records = [make.visualRecord({ planItemId: 'a' })]
    rerender(
      <PaneContent
        state={s}
        commands={commands()}
        renderVisual={(r) => <p>{r === preview ? 'preview' : 'stored'}</p>}
      />,
    )
    expect(screen.getByText('stored')).toBeDefined()
    expect(screen.queryByText('Adding animation…')).toBeNull()
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
    s.section = make.sectionNode({
      headingPath: ['5 Replication', '5.1 Leaders'],
    })
    render(
      <PaneContent state={s} commands={commands()} renderVisual={() => null} />,
    )
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

describe('whole-book bar (ADR 0057)', () => {
  const bar = (
    edit: (s: ReturnType<typeof createPaneState>) => void,
    c = commands(),
  ) => {
    const s = createPaneState()
    s.bookId = 'book'
    s.signedIn = true
    s.bookRun.total = 12
    s.bookRun.cachedCount = 3
    edit(s)
    render(<PaneContent state={s} commands={c} renderVisual={() => null} />)
    return c
  }
  const region = () => screen.getByRole('region', { name: 'Whole book' })
  const press = (name: string) =>
    fireEvent.click(within(region()).getByRole('button', { name }))
  const idleButton = () =>
    within(region()).getByRole('button', {
      name: 'Illustrate whole book',
    }) as HTMLButtonElement

  it('sits between the header and the meta line, and is hidden without a book or with the flag off', () => {
    bar(() => {})
    const pane = screen.getByRole('region', { name: 'Illustrate' })
    const kids = Array.from(pane.children)
    expect(kids.indexOf(region())).toBe(1)
    expect(kids[2]!.className).toBe('illus-meta')
    cleanup()
    bar((s) => {
      s.preferences.flags = { ...s.preferences.flags, wholeBook: false }
    })
    expect(screen.queryByRole('region', { name: 'Whole book' })).toBeNull()
    cleanup()
    bar((s) => {
      s.bookId = null
    })
    expect(screen.queryByRole('region', { name: 'Whole book' })).toBeNull()
  })
  it('idle: shows the count and asks for confirmation', () => {
    const c = bar(() => {})
    expect(
      within(region()).getByText('3 of 12 sections illustrated'),
    ).toBeDefined()
    press('Illustrate whole book')
    expect(c.bookConfirm).toHaveBeenCalledOnce()
  })
  it('idle: says the book is being prepared until its sections are counted', () => {
    bar((s) => {
      s.bookRun.total = 0
    })
    expect(within(region()).getByText('Preparing the book…')).toBeDefined()
  })
  it('idle: the button is disabled offline and when signed out with sign-in configured', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    bar(() => {})
    expect(idleButton().disabled).toBe(true)
    online.mockRestore()
    cleanup()
    bar((s) => {
      s.signedIn = false
      s.signinConfigured = true
    })
    expect(idleButton().disabled).toBe(true)
    cleanup()
    bar((s) => {
      s.signedIn = false
      s.signinConfigured = false
    })
    expect(idleButton().disabled).toBe(false)
  })
  it('confirm: explains the cost and offers Start and Cancel', () => {
    const c = bar((s) => {
      s.bookRun.status = 'confirm'
      s.bookRun.estimate = 27
    })
    expect(region().textContent).toContain(
      'Illustrate the remaining 9 sections?',
    )
    expect(region().textContent).toContain('about 27 requests')
    expect(region().textContent).toContain('even with this pane closed')
    press('Start')
    expect(c.bookStart).toHaveBeenCalledOnce()
    press('Cancel')
    expect(c.bookCancel).toHaveBeenCalledOnce()
  })
  it('understanding: shows concept-pass progress and pauses', () => {
    const c = bar((s) => {
      s.bookRun.status = 'understanding'
      s.bookRun.indexed = { indexed: 4, total: 12 }
    })
    expect(
      within(region()).getByText('Understanding the book: 4 of 12 sections'),
    ).toBeDefined()
    const progress = region().querySelector('progress')!
    expect(progress.value).toBe(4)
    expect(progress.max).toBe(12)
    press('Pause')
    expect(c.bookPause).toHaveBeenCalledOnce()
  })
  it('illustrating: shows finished, failed items and pauses', () => {
    const c = bar((s) => {
      s.bookRun.status = 'illustrating'
      s.bookRun.finished = 5
      s.bookRun.failedItems = 2
    })
    expect(
      within(region()).getByText('Illustrating book: 5 / 12 · 2 failed'),
    ).toBeDefined()
    expect(region().querySelector('progress')!.value).toBe(5)
    expect(region().querySelector('[aria-live="polite"]')).not.toBeNull()
    press('Pause')
    expect(c.bookPause).toHaveBeenCalledOnce()
  })
  it('paused: resumes', () => {
    const c = bar((s) => {
      s.bookRun.status = 'paused'
      s.bookRun.finished = 5
    })
    expect(within(region()).getByText('Paused at 5 / 12')).toBeDefined()
    press('Resume')
    expect(c.bookResume).toHaveBeenCalledOnce()
  })
  it('paused-limit: says why, labels the local pause, and offers an access check', () => {
    const resetAt = new Date(2030, 0, 1, 14, 5).getTime()
    const c = bar((s) => {
      s.bookRun.status = 'paused-limit'
      s.bookRun.resetAt = resetAt
      s.bookRun.message = 'Still paused by the ChatGPT plan limit.'
    })
    const text = region().textContent!
    expect(text).toContain(
      'Paused after an OpenAI usage-limit error. Local pause until',
    )
    expect(text).not.toContain('Resets')
    expect(text).toContain(
      new Date(resetAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    )
    expect(text).toContain('Resume checks your access again.')
    expect(text).toContain('Still paused by the ChatGPT plan limit.')
    press('Resume')
    expect(c.bookResume).toHaveBeenCalledOnce()
  })
  it('paused-limit without a known reset omits the time', () => {
    bar((s) => {
      s.bookRun.status = 'paused-limit'
    })
    expect(region().textContent).toContain(
      'Paused after an OpenAI usage-limit error. Resume checks your access again.',
    )
  })
  it('done: reports completion, and retries failed items only when some failed', () => {
    bar((s) => {
      s.bookRun.status = 'done'
    })
    expect(within(region()).getByText('Book illustrated')).toBeDefined()
    expect(within(region()).queryByRole('button')).toBeNull()
    cleanup()
    const c = bar((s) => {
      s.bookRun.status = 'done'
      s.bookRun.failedItems = 3
    })
    expect(
      within(region()).getByText('Book illustrated · 3 items failed'),
    ).toBeDefined()
    press('Retry failed')
    expect(c.bookStart).toHaveBeenCalledOnce()
  })
})
