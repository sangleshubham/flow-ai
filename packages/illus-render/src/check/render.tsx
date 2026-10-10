// Browser helper for §16 L4/L5: renders an IR offscreen with <VisualView> at 900 px, waits for
// `data-ready`, runs the render checks and exports a 2× PNG for the critic. `criticHook` adapts the
// review loop to the pipeline's `critic(record)` hook.
import { createRoot } from 'react-dom/client'

import type { CriticReport, IR, TemplateRegistry, ThemeTokens, VisualRecord } from '@illus/core'

import { exportPng } from '../export.ts'
import type { RenderTemplate } from '../types.ts'
import { VisualView } from '../VisualView.tsx'
import { checkRender } from './dom.ts'
import { reviewVisual } from './review.ts'
import type { Rendered, ReviewEnv } from './review.ts'

/** §16: the critic sees the visual at 900 px width, 2× scale. */
export const REVIEW_WIDTH = 900
export const REVIEW_SCALE = 2

export interface RenderForReviewOptions {
  theme: ThemeTokens
  templates?: TemplateRegistry<RenderTemplate>
  timeoutMs?: number
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function waitReady(host: HTMLElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => host.querySelector('.illus-view[data-ready="true"]') || host.querySelector('[role="alert"]')
    if (done()) return resolve()
    const obs = new MutationObserver(() => {
      if (!done()) return
      obs.disconnect()
      clearTimeout(timer)
      resolve()
    })
    const timer = setTimeout(() => {
      obs.disconnect()
      reject(new Error(`visual not ready after ${timeoutMs} ms`))
    }, timeoutMs)
    obs.observe(host, { subtree: true, attributes: true, childList: true })
  })
}

/**
 * Renders `ir` offscreen, checks it (§16 L4) and returns the PNG for the critic: the SVG at its natural
 * size, capped at 900 px wide, at 2× density. Kinds without an SVG return no PNG and no findings.
 */
export async function renderForReview(ir: IR, o: RenderForReviewOptions): Promise<Rendered> {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${REVIEW_WIDTH}px;pointer-events:none`
  document.body.append(host)
  const root = createRoot(host)
  try {
    root.render(<VisualView spec={{ ir }} theme={o.theme} {...(o.templates && { templates: o.templates })} flags={{ htmlFallback: false }} />)
    await waitReady(host, o.timeoutMs ?? 15_000)
    if (host.querySelector('[role="alert"]')) throw new Error(host.querySelector('[role="alert"]')!.textContent ?? 'render failed')
    const svg = host.querySelector<SVGSVGElement>('.illus-canvas svg')
    if (!svg) return { issues: [], pngBase64: null }
    const { issues, geometry } = checkRender(svg)
    const width = geometry?.width || REVIEW_WIDTH
    const png = await exportPng(svg, o.theme, (REVIEW_SCALE * Math.min(REVIEW_WIDTH, width)) / width)
    return { issues, pngBase64: await toBase64(png) }
  } finally {
    root.unmount()
    host.remove()
  }
}

export interface CriticHookEnv extends Omit<ReviewEnv, 'render' | 'intent' | 'repair'>, RenderForReviewOptions {
  /** The plan item's intent of a record (from the plan record); empty when unknown. */
  intent?: (record: VisualRecord) => string | Promise<string>
}

/**
 * For today's `PipelineDeps.critic(record) => CriticReport` hook: render checks and critic only (the
 * hook cannot return a repaired IR or the context `repair` needs; see ADR 0043 for the full hook).
 */
export function criticHook(env: CriticHookEnv): (record: VisualRecord) => Promise<CriticReport | undefined> {
  return async (record) => {
    const reviewed = await reviewVisual(record, {
      ...env,
      intent: (await env.intent?.(record)) ?? '',
      render: (ir) => renderForReview(ir, env),
    })
    return reviewed.critic
  }
}
