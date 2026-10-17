// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IllustrateSettings } from './IllustrateSettings'
import {
  cancelBookRunConfirm,
  confirmBookRun,
  pauseBookRun,
  resumeBookRun,
  savePreferences,
  startBookRun,
  togglePane,
} from './runtime'
import { createPaneState, pane } from './state'

vi.mock('./runtime', () => ({
  cancelBookRunConfirm: vi.fn(),
  confirmBookRun: vi.fn(),
  pauseBookRun: vi.fn(),
  resumeBookRun: vi.fn(),
  startBookRun: vi.fn(),
  clearVisuals: vi.fn(),
  downloadCache: vi.fn(),
  reindex: vi.fn(),
  savePreferences: vi.fn(),
  togglePane: vi.fn(),
  uploadCache: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('exposes the remembered step option independently of focus and hover highlighting', () => {
  Object.assign(pane, createPaneState())
  pane.preferences.autoHighlight = false
  render(<IllustrateSettings />)
  const step = screen.getByRole('checkbox', {
    name: 'Highlight the passage while an animation plays',
  }) as HTMLInputElement
  expect(step.checked).toBe(true)
  expect(
    (
      screen.getByRole('checkbox', {
        name: 'Highlight evidence on focus and hover',
      }) as HTMLInputElement
    ).checked,
  ).toBe(false)
  fireEvent.click(step)
  expect(savePreferences).toHaveBeenCalledWith(
    expect.objectContaining({
      highlightSteps: false,
      autoHighlight: false,
    }),
  )
})

it('turns scene animations for graphs on through the saved feature flags only', () => {
  Object.assign(pane, createPaneState())
  render(<IllustrateSettings />)
  const scene = screen.getByRole('checkbox', {
    name: 'Scene animations for graphs (beta)',
  }) as HTMLInputElement
  // Off by default (ADR 0050); the step animations flag next to it is on.
  expect(scene.checked).toBe(false)
  expect(
    (
      screen.getByRole('checkbox', {
        name: 'Step animations',
      }) as HTMLInputElement
    ).checked,
  ).toBe(true)
  fireEvent.click(scene)
  expect(savePreferences).toHaveBeenCalledWith(
    expect.objectContaining({
      flags: expect.objectContaining({
        sceneAnimations: true,
        animations: true,
      }),
    }),
  )
})

describe('whole-book setting', () => {
  const setup = (edit: (s: typeof pane) => void = () => {}) => {
    Object.assign(pane, createPaneState())
    pane.bookId = 'book'
    pane.signedIn = true
    pane.bookRun.total = 8
    pane.bookRun.cachedCount = 2
    edit(pane)
    render(<IllustrateSettings />)
  }
  it('shows the status and starts the confirmation from the pane', () => {
    setup()
    expect(screen.getByText('2 of 8 sections illustrated')).toBeDefined()
    fireEvent.click(
      screen.getByRole('button', { name: 'Illustrate whole book' }),
    )
    expect(togglePane).toHaveBeenCalledOnce()
    expect(confirmBookRun).toHaveBeenCalledOnce()
  })
  it('does not toggle an already open pane', () => {
    setup((s) => {
      s.open = true
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Illustrate whole book' }),
    )
    expect(togglePane).not.toHaveBeenCalled()
    expect(confirmBookRun).toHaveBeenCalledOnce()
  })
  it('pauses while running, resumes when paused, cancels a pending confirmation and retries failures', () => {
    setup((s) => {
      s.bookRun.status = 'illustrating'
      s.bookRun.finished = 3
    })
    expect(screen.getByText('Illustrating book: 3 / 8')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(pauseBookRun).toHaveBeenCalledOnce()
    cleanup()
    setup((s) => {
      s.bookRun.status = 'paused'
    })
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(resumeBookRun).toHaveBeenCalledOnce()
    cleanup()
    setup((s) => {
      s.bookRun.status = 'confirm'
    })
    // Closed, the confirm card is out of sight: the button opens the pane instead.
    fireEvent.click(
      screen.getByRole('button', { name: 'Open Illustrate pane' }),
    )
    expect(togglePane).toHaveBeenCalledOnce()
    cleanup()
    setup((s) => {
      s.open = true
      s.bookRun.status = 'confirm'
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancelBookRunConfirm).toHaveBeenCalledOnce()
    cleanup()
    setup((s) => {
      s.bookRun.status = 'done'
      s.bookRun.failedItems = 1
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed' }))
    expect(startBookRun).toHaveBeenCalledOnce()
  })
  it('is hidden when the flag is off or no book is open', () => {
    setup((s) => {
      s.preferences.flags = { ...s.preferences.flags, wholeBook: false }
    })
    expect(screen.queryByText('2 of 8 sections illustrated')).toBeNull()
    cleanup()
    setup((s) => {
      s.bookId = null
    })
    expect(screen.queryByText('2 of 8 sections illustrated')).toBeNull()
  })
})
