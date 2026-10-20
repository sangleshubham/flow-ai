import type { GraphColor } from '@illus/core'

/** Stable assignment order, independent of theme and object property enumeration. */
export const GROUP_COLOR_ORDER: readonly GraphColor[] = [
  'blue',
  'green',
  'orange',
  'red',
  'purple',
  'gray',
]

interface PaletteEntry {
  fill: string
  nodeFill: string
  /** Shared label and border colour; AA against both opaque tints. */
  ink: string
}

/** Resolved to CSS custom properties by themeVars, including in standalone exports (ADR 0063). */
export const GROUP_PALETTE: Record<
  'light' | 'dark',
  Record<GraphColor, PaletteEntry>
> = {
  light: {
    blue: { fill: '#e5efff', nodeFill: '#f2f7ff', ink: '#17469e' },
    green: { fill: '#e3f3e8', nodeFill: '#f1faf4', ink: '#166534' },
    orange: { fill: '#fff0df', nodeFill: '#fff7ed', ink: '#9a3412' },
    red: { fill: '#fee8e8', nodeFill: '#fff4f4', ink: '#991b1b' },
    purple: { fill: '#f1e8ff', nodeFill: '#faf5ff', ink: '#6b21a8' },
    gray: { fill: '#e9edf2', nodeFill: '#f5f7fa', ink: '#374151' },
  },
  dark: {
    blue: { fill: '#172c49', nodeFill: '#142338', ink: '#9ec5ff' },
    green: { fill: '#17372b', nodeFill: '#14291f', ink: '#93e5b2' },
    orange: { fill: '#432a19', nodeFill: '#302219', ink: '#fdba74' },
    red: { fill: '#442326', nodeFill: '#302023', ink: '#fca5a5' },
    purple: { fill: '#322447', nodeFill: '#251e33', ink: '#d8b4fe' },
    gray: { fill: '#2b323d', nodeFill: '#202731', ink: '#cbd5e1' },
  },
}
