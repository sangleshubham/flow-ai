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
  bookRetry: vi.fn(),
  bookStop: vi.fn(),
  goToSection: vi.fn(),
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
  it('preparing: names the step with its progress and queues a press visibly (ADR 0064)', () => {
    const c = bar((s) => {
      s.bookRun.status = 'preparing'
      s.bookRun.preparing = { label: 'Indexing the book', done: 3, total: 10 }
    })
    expect(
      within(region()).getByText(
        'Preparing the book: Indexing the book 3 / 10…',
      ),
    ).toBeDefined()
    press('Illustrate whole book')
    expect(c.bookConfirm).toHaveBeenCalledOnce()
    cleanup()
    bar((s) => {
      s.bookRun.status = 'preparing'
      s.bookRun.preparing = { label: 'Opening the book' }
      s.bookRun.queued = 'confirm'
    })
    expect(
      within(region()).getByText(
        'Preparing the book: Opening the book… Will start when the book is ready.',
      ),
    ).toBeDefined()
    expect(
      within(region()).queryByRole('button', { name: 'Illustrate whole book' }),
    ).toBeNull()
  })
  it('stopping and error have their own text; an error shows why and retries (ADR 0064)', () => {
    let c = bar((s) => {
      s.bookRun.status = 'stopping'
    })
    expect(
      within(region()).getByText('Stopping the previous run…'),
    ).toBeDefined()
    press('Pause')
    expect(c.bookPause).toHaveBeenCalledOnce()
    cleanup()
    c = bar((s) => {
      s.bookRun.status = 'error'
      s.bookRun.message = 'The EPUB file is unavailable.'
    })
    press('Retry')
    expect(c.bookRetry).toHaveBeenCalledOnce()
    expect(
      within(region()).getByText('The book could not be prepared.', {
        exact: false,
      }),
    ).toBeDefined()
    expect(
      within(region()).getByText('The EPUB file is unavailable.', {
        exact: false,
      }),
    ).toBeDefined()
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
      within(region()).getByText('Illustrating book: 5 / 12 · 2 items failed'),
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
    expect(
      within(region()).queryByRole('button', { name: 'Retry failed' }),
    ).toBeNull()
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

describe('book progress panel', () => {
  afterEach(() => localStorage.clear())
  const setup = () => {
    const s = createPaneState()
    s.bookId = 'book'
    s.signedIn = true
    s.bookRun.status = 'illustrating'
    s.bookRun.total = 6
    s.bookRun.finished = 4
    s.bookRun.sections = {
      a: 'done',
      b: 'cached',
      c: 'no-visual',
      d: 'failed',
      e: 'running',
      f: 'pending',
    }
    s.bookRun.inProgress = ['e']
    s.bookRun.cursor = 'f'
    const c = commands()
    const sections = Object.keys(s.bookRun.sections).map((sectionId, ordinal) =>
      make.sectionNode({
        sectionId,
        ordinal,
        title: `Section ${sectionId}`,
        parentId: ordinal ? 'a' : undefined,
      }),
    )
    const ui = () => (
      <PaneContent
        state={s}
        commands={c}
        sections={sections}
        renderVisual={() => null}
      />
    )
    return { s, c, ui, ...render(ui()) }
  }
  it('offers Stop during preparation only when a start is queued', () => {
    const { s, c, ui, rerender } = setup()
    s.bookRun.status = 'preparing'
    s.bookRun.queued = null
    rerender(ui())
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(c.bookStop).not.toHaveBeenCalled()
    s.bookRun.queued = 'start'
    rerender(ui())
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }))
    expect(c.bookStop).toHaveBeenCalledOnce()
  })
  it.each(['idle', 'paused', 'paused-limit', 'done'] as const)(
    'labels the progress bar as completed sections in %s',
    (status) => {
      const { s, ui, rerender } = setup()
      s.bookRun.status = status
      rerender(ui())
      expect(
        screen.getByRole('progressbar', { name: 'Sections illustrated' }),
      ).toBeDefined()
      expect(
        screen.queryByRole('progressbar', { name: 'Illustrating the book' }),
      ).toBeNull()
    },
  )
  it('keeps the idle breakdown without a duplicate count paragraph', () => {
    const { s, ui, rerender } = setup()
    s.bookRun.status = 'idle'
    rerender(ui())
    expect(screen.getByText('0 of 6 sections illustrated')).toBeDefined()
    expect(document.querySelector('.illus-book-run-count')).toBeNull()
    expect(
      screen.getByRole('list', { name: 'Section breakdown' }),
    ).toBeDefined()
  })
  it('distinguishes failed items in the status from failed sections in the breakdown', () => {
    const { s, ui, rerender } = setup()
    s.bookRun.failedItems = 2
    rerender(ui())
    expect(
      screen.getByText('Illustrating book: 4 / 6 · 2 items failed'),
    ).toBeDefined()
    expect(
      screen.getByRole('list', { name: 'Section breakdown' }).textContent,
    ).toContain('1 failed')
  })
  it('shows a readable summary, a determinate bar, elapsed time and a delayed ETA', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(300_000)
      const { s, ui, rerender } = setup()
      s.bookRun.startedAt = 0
      s.bookRun.session = { startedAt: 0, done: 1, avgSectionMs: 1_440_000 }
      rerender(ui())
      expect(screen.getByText('4 of 6 sections')).toBeDefined()
      for (const text of ['1 new', '1 cached', '1 no visual', '1 failed'])
        expect(screen.getByText(text, { exact: false })).toBeDefined()
      expect(screen.getByText('5 min 0 s elapsed')).toBeDefined()
      expect(screen.queryByText(/min left/)).toBeNull()
      s.bookRun.session.done = 2
      rerender(ui())
      expect(screen.getByText(/about 12 min left/)).toBeDefined()
      act(() => vi.advanceTimersByTime(1000))
      expect(
        screen.getByText('5 min 1 s elapsed', { exact: false }),
      ).toBeDefined()
      const progress = screen.getByRole('progressbar', {
        name: 'Illustrating the book',
      }) as HTMLProgressElement
      expect([progress.value, progress.max]).toEqual([4, 6])
    } finally {
      vi.useRealTimers()
    }
  })
  it('requires an inline Stop confirmation and lets the user keep running', () => {
    const { c } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(
      screen.getByText('Stop the run? Saved illustrations are kept.'),
    ).toBeDefined()
    expect(c.bookStop).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep running' }))
    expect(c.bookStop).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }))
    expect(c.bookStop).toHaveBeenCalledOnce()
  })
  it('groups titled section links, highlights running and cursor rows, and filters statuses', () => {
    const { c } = setup()
    const expand = screen.getByRole('button', { name: /Sections/ })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /Section e/ })).toBeNull()
    fireEvent.click(expand)
    const list = within(screen.getByRole('region', { name: 'Run sections' }))
    expect(list.getAllByRole('listitem')).toHaveLength(6)
    const running = list.getByRole('button', { name: /Section e Running/ })
    expect(running.parentElement!.getAttribute('data-running')).toBe('true')
    const cursor = list.getByRole('button', {
      name: /Section f Pending · Resume here/,
    })
    expect(cursor.parentElement!.getAttribute('data-cursor')).toBe('true')
    fireEvent.click(running)
    expect(c.goToSection).toHaveBeenCalledWith('e')
    const filters = within(
      screen.getByRole('group', { name: 'Filter sections' }),
    )
    for (const [filter, count] of [
      ['Failed', 1],
      ['Pending', 2],
      ['Done', 3],
      ['All', 6],
    ] as const) {
      fireEvent.click(filters.getByRole('button', { name: filter }))
      expect(list.getAllByRole('listitem')).toHaveLength(count)
    }
  })
  it('remembers expansion for this viewer and survives blocked storage', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Sections/ }))
    cleanup()
    setup()
    expect(
      screen
        .getByRole('button', { name: /Sections/ })
        .getAttribute('aria-expanded'),
    ).toBe('true')
    cleanup()
    const get = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked')
      })
    const set = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked')
      })
    try {
      setup()
      fireEvent.click(screen.getByRole('button', { name: /Sections/ }))
      expect(screen.getByRole('region', { name: 'Run sections' })).toBeDefined()
    } finally {
      get.mockRestore()
      set.mockRestore()
    }
  })
  it('shows known preparation progress and leaves unknown preparation indeterminate', () => {
    const { s, ui, rerender } = setup()
    s.bookRun.status = 'preparing'
    s.bookRun.preparing = { label: 'Indexing', done: 3, total: 10 }
    rerender(ui())
    const progress = screen.getByRole('progressbar', {
      name: 'Preparing the book',
    }) as HTMLProgressElement
    expect([progress.value, progress.max]).toEqual([3, 10])
    s.bookRun.preparing = { label: 'Opening' }
    rerender(ui())
    expect(progress.hasAttribute('value')).toBe(false)
  })
  it('renders 500 navigable targets only when expanded', () => {
    const { s, ui, rerender } = setup()
    s.bookRun.sections = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`target-${i}`, 'pending']),
    )
    rerender(ui())
    expect(screen.queryByRole('region', { name: 'Run sections' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Sections/ }))
    const list = within(screen.getByRole('region', { name: 'Run sections' }))
    expect(list.getAllByRole('listitem')).toHaveLength(500)
    expect(
      list.getByRole('button', { name: 'target-499 Pending' }),
    ).toBeDefined()
  })
})
