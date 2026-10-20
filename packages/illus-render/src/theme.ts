// Theme tokens (§10): the ten `--illus-*` variables derived from Flow's Material You theme
// (docs/flow-audit.md §6). Renderers only ever reference these variables or the resolved token values.
import { useEffect, useState } from 'react'

import { THEME_TOKEN_VARS } from '@illus/core'
import type { ThemeTokens } from '@illus/core'

import { GROUP_PALETTE } from './graph/palette.ts'

type Colour = Exclude<keyof ThemeTokens, 'font' | 'mono' | 'dark'>

/** Flow variable (space-separated RGB triple) behind each colour token, plus a CSS system colour fallback. */
const FLOW_COLOURS: Record<
  Exclude<Colour, 'highlight'>,
  [flowVar: string, fallback: string]
> = {
  bg: ['--md-sys-color-surface', 'Canvas'],
  fg: ['--md-sys-color-on-surface', 'CanvasText'],
  muted: ['--md-sys-color-on-surface-variant', 'GrayText'],
  line: ['--md-sys-color-outline-variant', 'GrayText'],
  accent: ['--md-sys-color-primary', 'LinkText'],
  new: ['--md-sys-color-tertiary', 'Highlight'],
  earlier: ['--md-sys-color-outline', 'GrayText'],
}
const FLOW_FONT = '--md-sys-typescale-body-medium-family'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/** Builds tokens from a variable reader (e.g. `getComputedStyle(html).getPropertyValue`). Pure. */
export function tokensFromFlowVars(
  read: (name: string) => string,
  dark: boolean,
): ThemeTokens {
  const rgb = (name: string, fallback: string, alpha?: number) => {
    const v = read(name).trim()
    if (!v) return fallback
    return alpha === undefined ? `rgb(${v})` : `rgb(${v} / ${alpha})`
  }
  const colours = Object.fromEntries(
    Object.entries(FLOW_COLOURS).map(([k, [name, fallback]]) => [
      k,
      rgb(name, fallback),
    ]),
  ) as Record<Exclude<Colour, 'highlight'>, string>
  const font = read(FLOW_FONT).trim()
  return {
    ...colours,
    highlight: rgb(FLOW_COLOURS.accent[0], 'Mark', 0.2),
    font: font ? `${font}, system-ui, sans-serif` : 'system-ui, sans-serif',
    mono: MONO,
    dark,
  }
}

/** Reads Flow's active theme from `<html>`: Material tokens plus the `dark` class. */
export function readFlowTheme(
  root: HTMLElement = document.documentElement,
): ThemeTokens {
  const style = getComputedStyle(root)
  return tokensFromFlowVars(
    (n) => style.getPropertyValue(n),
    root.classList.contains('dark'),
  )
}

/**
 * Calls `cb` whenever Flow's theme changes: the `dark` class on `<html>` or the injected
 * `<style id="theme">` (source-colour change). Returns an unsubscribe function.
 */
export function watchFlowTheme(
  cb: (t: ThemeTokens) => void,
  root: HTMLElement = document.documentElement,
): () => void {
  let last = JSON.stringify(readFlowTheme(root))
  const observer = new MutationObserver(() => {
    const next = readFlowTheme(root)
    const key = JSON.stringify(next)
    if (key !== last) {
      last = key
      cb(next)
    }
  })
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['class', 'style'],
  })
  if (root.ownerDocument.head)
    observer.observe(root.ownerDocument.head, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  return () => observer.disconnect()
}

/** React hook: Flow's current theme tokens, updated on theme change. */
export function useFlowTheme(): ThemeTokens {
  const [tokens, setTokens] = useState(() => readFlowTheme())
  useEffect(() => {
    setTokens(readFlowTheme())
    return watchFlowTheme(setTokens)
  }, [])
  return tokens
}

/** The `--illus-*` CSS variables for a token set, as a React `style` object. */
export function themeVars(t: ThemeTokens): Record<string, string> {
  return Object.fromEntries([
    ...Object.entries(THEME_TOKEN_VARS).map(([k, v]) => [
      v,
      t[k as keyof typeof THEME_TOKEN_VARS],
    ]),
    ...Object.entries(GROUP_PALETTE[t.dark ? 'dark' : 'light']).flatMap(
      ([name, entry]) => [
        [`--illus-${name}-fill`, entry.fill],
        [`--illus-${name}-node-fill`, entry.nodeFill],
        [`--illus-${name}-ink`, entry.ink],
      ],
    ),
  ])
}

/**
 * Resolves any CSS colour (including `rgb(1 2 3 / 0.2)` and system colours) to a form colour libraries
 * such as Mermaid's khroma can parse (`#rrggbb` or `rgba(…)`), using the canvas colour parser.
 * Returns the input unchanged where no canvas exists (tests).
 */
export function resolveColour(colour: string): string {
  const ctx = colourCtx()
  if (!ctx) return colour
  ctx.fillStyle = '#000000'
  ctx.fillStyle = colour
  return String(ctx.fillStyle)
}

let ctxCache: CanvasRenderingContext2D | null | undefined
function colourCtx(): CanvasRenderingContext2D | null {
  if (ctxCache !== undefined) return ctxCache
  try {
    ctxCache =
      typeof document === 'undefined'
        ? null
        : document.createElement('canvas').getContext('2d')
  } catch {
    ctxCache = null
  }
  return ctxCache
}

/** Token set with every colour resolved by `resolveColour`. */
export function resolveTokens(t: ThemeTokens): ThemeTokens {
  const out = { ...t }
  for (const k of [
    'bg',
    'fg',
    'muted',
    'line',
    'accent',
    'new',
    'earlier',
    'highlight',
  ] as const)
    out[k] = resolveColour(t[k])
  return out
}
