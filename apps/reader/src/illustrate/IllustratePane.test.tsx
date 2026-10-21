// @vitest-environment jsdom
import { make } from '@illus/core/testing'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IllustratePane } from './IllustratePane'
import { goToSection, stopBookRun, togglePane } from './runtime'
import { createPaneState, pane } from './state'

vi.mock('../components/base', () => ({
  useSplitViewItem: () => ({ size: 320 }),
}))
vi.mock('../models', () => {
  const reader = { focusedBookTab: { id: 'tab', book: { id: 'flow-book' } } }
  return { reader, useReaderSnapshot: () => reader }
})
vi.mock('./RecordView', () => ({ RecordView: () => null }))
vi.mock('./runtime', () => ({
  activate: vi.fn(),
  activeSections: () => [
    make.sectionNode({ sectionId: 'target', title: 'A target section' }),
  ],
  approveIndexing: vi.fn(),
  cancelBookRunConfirm: vi.fn(),
  confirmBookRun: vi.fn(),
  deactivate: vi.fn(),
  goPrevious: vi.fn(),
  goToSection: vi.fn(),
  illustrateSelection: vi.fn(),
  loadPreferences: vi.fn(async () => {}),
  networkChanged: vi.fn(),
  paneClosed: vi.fn(),
  paneOpened: vi.fn(),
  pauseBookRun: vi.fn(),
  reportError: vi.fn(),
  requestVisual: vi.fn(),
  retryVisual: vi.fn(),
  resumeBookRun: vi.fn(),
  retryActivate: vi.fn(),
  setPinned: vi.fn(),
  startBookRun: vi.fn(),
  stopBookRun: vi.fn(),
  togglePane: vi.fn(),
}))

beforeEach(() => {
  Object.assign(pane, createPaneState())
  pane.bookId = 'book'
  pane.bookRun.total = 100
  pane.bookRun.finished = 42
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

describe('closed book progress rail', () => {
  it('shows a visible percentage and exposes the status on the toggle', () => {
    pane.bookRun.status = 'illustrating'
    render(<IllustratePane />)
    expect(screen.getByText('42%')).toBeDefined()
    const toggle = screen.getByRole('button', {
      name: /Open Illustrate. Illustrating book: 42 \/ 100/,
    })
    fireEvent.click(toggle)
    expect(togglePane).toHaveBeenCalledOnce()
  })
  it.each(['paused', 'paused-limit', 'error'] as const)(
    'shows a visible status marker for %s',
    (status) => {
      pane.bookRun.status = status
      pane.bookRun.message =
        status === 'error' ? 'The file is unavailable.' : ''
      const { container } = render(<IllustratePane />)
      expect(screen.getByText('42%')).toBeDefined()
      expect(container.querySelector('.illus-run-dot')!.textContent).toBe(
        status === 'error' ? '!' : 'Ⅱ',
      )
      const toggle = screen.getByRole('button', { name: /Open Illustrate/ })
      expect(toggle.getAttribute('aria-label')).toContain(
        status === 'error' ? 'The file is unavailable.' : 'Paused',
      )
    },
  )
  it('keeps both paused and error markers when a paused run has failed items', () => {
    pane.bookRun.status = 'paused'
    pane.bookRun.failedItems = 2
    const { container } = render(<IllustratePane />)
    const badge = container.querySelector('.illus-run-badge')!
    expect(badge.getAttribute('data-status')).toBe('failed')
    expect(badge.textContent).toContain('Ⅱ')
    expect(badge.textContent).toContain('!')
    expect(
      badge.querySelector('.illus-run-dot[data-kind="error"]')!.textContent,
    ).toBe('!')
  })
  it('shows preparation while counts are not ready and hides the badge when disabled', () => {
    pane.bookRun.status = 'preparing'
    pane.bookRun.preparing = { label: 'Opening the book' }
    const { container } = render(<IllustratePane />)
    expect(container.querySelector('.illus-run-badge')!.textContent).toBe('…')
    cleanup()
    pane.preferences.flags = { ...pane.preferences.flags, wholeBook: false }
    render(<IllustratePane />)
    expect(screen.queryByText('…')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Open Illustrate' }),
    ).toBeDefined()
  })
})

it('wires Stop and section links from the open panel to runtime commands', () => {
  pane.open = true
  pane.bookRun.status = 'illustrating'
  pane.bookRun.sections = { target: 'running' }
  render(<IllustratePane />)
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
  expect(stopBookRun).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Stop run' }))
  expect(stopBookRun).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: /Sections/ }))
  fireEvent.click(
    screen.getByRole('button', { name: 'A target section Running' }),
  )
  expect(goToSection).toHaveBeenCalledWith('target')
})
