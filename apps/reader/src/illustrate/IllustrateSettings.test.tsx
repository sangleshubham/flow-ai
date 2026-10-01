// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { IllustrateSettings } from './IllustrateSettings'
import { savePreferences } from './runtime'
import { createPaneState, pane } from './state'

vi.mock('./runtime', () => ({
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
