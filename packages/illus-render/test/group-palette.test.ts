import { make } from '@illus/core/testing'
import { describe, expect, it } from 'vitest'

import { GROUP_PALETTE } from '../src/graph/palette.ts'
import { SVG_CSS } from '../src/styles.ts'
import { themeVars } from '../src/theme.ts'

// WCAG relative luminance: linearise sRGB before weighting the channels.
function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((c) => {
      const s = parseInt(c, 16) / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
}

describe('group palette', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`has AA text contrast on opaque group and node tints in ${mode} mode`, () => {
      for (const [name, entry] of Object.entries(GROUP_PALETTE[mode])) {
        for (const fill of [entry.fill, entry.nodeFill]) {
          expect(fill).toMatch(/^#[0-9a-f]{6}$/i)
          const a = luminance(entry.ink)
          const b = luminance(fill)
          expect(
            (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
            `${mode} ${name} on ${fill}`,
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    it(`exposes the ${mode} palette as custom properties used by the SVG stylesheet`, () => {
      const vars = themeVars(make.themeTokens({ dark: mode === 'dark' }))
      for (const [name, entry] of Object.entries(GROUP_PALETTE[mode])) {
        expect(vars[`--illus-${name}-fill`]).toBe(entry.fill)
        expect(vars[`--illus-${name}-node-fill`]).toBe(entry.nodeFill)
        expect(vars[`--illus-${name}-ink`]).toBe(entry.ink)
        for (const suffix of ['fill', 'node-fill', 'ink'])
          expect(SVG_CSS).toContain(`var(--illus-${name}-${suffix})`)
      }
    })
  }
})
