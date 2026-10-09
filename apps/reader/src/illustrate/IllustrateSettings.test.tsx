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
