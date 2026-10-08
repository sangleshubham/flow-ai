import { THEME_TOKEN_VARS } from '@illus/core'
import { make } from '@illus/core/testing'
import { describe, expect, it } from 'vitest'

import { themeVars, tokensFromFlowVars } from '../src/theme.ts'

const LIGHT: Record<string, string> = {
  '--md-sys-color-surface': '251 252 254',
  '--md-sys-color-on-surface': '25 28 30',
  '--md-sys-color-on-surface-variant': '64 72 76',
  '--md-sys-color-outline-variant': '192 200 204',
  '--md-sys-color-primary': '0 101 140',
  '--md-sys-color-tertiary': '94 90 125',
  '--md-sys-color-outline': '112 120 125',
  '--md-sys-typescale-body-medium-family': 'Roboto',
}

describe('tokensFromFlowVars', () => {
  it('maps Flow Material tokens to the ten illus tokens (flow-audit §6)', () => {
    const t = tokensFromFlowVars((n) => LIGHT[n] ?? '', false)
    expect(t).toEqual({
      bg: 'rgb(251 252 254)',
      fg: 'rgb(25 28 30)',
      muted: 'rgb(64 72 76)',
      line: 'rgb(192 200 204)',
      accent: 'rgb(0 101 140)',
      new: 'rgb(94 90 125)',
      earlier: 'rgb(112 120 125)',
      highlight: 'rgb(0 101 140 / 0.2)',
      font: 'Roboto, system-ui, sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      dark: false,
    })
  })

  it('falls back to CSS system colours, never hard-coded ones, outside Flow', () => {
    const t = tokensFromFlowVars(() => '', true)
    expect(t.bg).toBe('Canvas')
    expect(t.fg).toBe('CanvasText')
    expect(t.dark).toBe(true)
    for (const v of [t.bg, t.fg, t.muted, t.line, t.accent, t.new, t.earlier, t.highlight]) expect(v).not.toMatch(/#|rgb/)
  })
})

describe('themeVars', () => {
  it('emits every --illus-* variable', () => {
    const vars = themeVars(make.themeTokens())
    expect(Object.keys(vars).sort()).toEqual(Object.values(THEME_TOKEN_VARS).sort())
    expect(vars['--illus-accent']).toBe('#0ea5e9')
  })
})
