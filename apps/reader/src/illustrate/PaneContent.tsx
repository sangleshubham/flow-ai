import type { VisualRecord } from '@illus/core'
import React from 'react'
import type { ReactNode } from 'react'

import type { PaneState } from './state'

export interface PaneCommands {
  close(): void
  pin(): void
  approve(): void
  retry(): void
  force(): void
  report(): void
  previous(): void
  selection(): void
  select(id: string): void
}
export interface PaneContentProps {
  state: PaneState
  commands: PaneCommands
  renderVisual(record: VisualRecord): ReactNode
}

/** Presentational state table; runtime effects stay outside component tests and SSR. */
export function PaneContent({ state: s, commands: c, renderVisual }: PaneContentProps) {
  const record = s.records.find((r) => r.planItemId === s.selectedItem) ?? s.records[0]
  const blocked = s.status === 'plan-limit' || s.status === 'signin-required'
  return <section className="illus-pane" aria-label="Illustrate" data-state={s.status}>
    <header className="illus-pane-header">
      <div><h2>Illustrate</h2><p className="illus-path">{s.section?.headingPath.join(' / ') || 'Your reading companion'}</p></div>
      <button onClick={c.pin} aria-label={s.pinned ? 'Unpin visual' : 'Pin visual'} aria-pressed={s.pinned}>{s.pinned ? 'Unpin' : 'Pin'}</button>
      <button onClick={c.close} aria-label="Close Illustrate">×</button>
    </header>
    <div className="illus-meta">
      <span>{s.progress || 'Open a book to begin'}</span>
      {s.usage && <span title="Local request caps">{s.usage.used5h}/{s.usage.max5h} requests · 5h; {s.usage.usedDay}/{s.usage.maxDay} today</span>}
    </div>
    <div className="illus-pane-body">
      {s.status === 'idle' && <div className="illus-state"><h3>See what you’re reading</h3><p>Open a book and navigate to a section. Diagrams link directly to their supporting passages.</p></div>}
      {s.status === 'indexing-required' && <div className="illus-state">
        <h3>{s.estimate ? 'Understand this book' : 'Indexing this book…'}</h3>
        <p>{s.estimate ? `Concept indexing is estimated to use ${s.estimate.requests} index requests and ${s.estimate.tokens.toLocaleString()} input tokens. Summary and glossary calls add a few more requests.` : 'Preparing section boundaries and passages on this device.'}</p>
        {s.estimate && <button onClick={c.approve}>Start indexing and illustrate</button>}
      </div>}
      {s.status === 'planning' && <div className="illus-state" aria-busy="true"><p>Reading this section…</p><div className="illus-skeleton" /></div>}
      {s.status === 'generating' && <div aria-busy="true">{s.items.map((i) => <div className="illus-state" key={i.planItemId}><h3>{i.intent}</h3><div className="illus-skeleton" /></div>)}</div>}
      {s.status === 'no-visual' && <div className="illus-state"><h3>No diagram needed</h3><p>{s.reason}</p><button onClick={c.force}>Illustrate anyway</button>{s.previousSectionId && <button onClick={c.previous}>Previous section’s visual</button>}</div>}
      {s.status === 'error' && <div className="illus-state" role="alert"><h3>Couldn’t finish this illustration</h3><p>{s.message}</p><button onClick={c.retry}>Retry</button><button onClick={c.report}>Report</button></div>}
      {blocked && <div className="illus-state" role="alert">
        <h3>{s.status === 'plan-limit' ? 'Plan requests are paused' : 'Connect your ChatGPT account'}</h3><p>{s.message || 'Your cached illustrations remain available.'}</p>
        {s.usage?.pausedUntil && <p>Resets {new Date(s.usage.pausedUntil).toLocaleString()}.</p>}
        {s.status === 'signin-required' ? <a className="illus-button" href="/auth/chatgpt/start">Continue with ChatGPT</a> : <a href="https://chatgpt.com/#settings" target="_blank" rel="noreferrer">ChatGPT Settings › Usage</a>}
        <button onClick={c.retry}>Retry</button>
      </div>}
      {s.status === 'offline' && <div className="illus-state" role="status"><h3>You’re offline</h3><p>{record ? 'Showing an illustration saved on this device.' : 'There is no saved illustration for this section. Reconnect to generate one.'}</p></div>}
      {(s.status === 'ready' || s.status === 'offline' || blocked) && record && <>
        <div className="illus-tabs" role="tablist" aria-label="Illustrations">{s.items.map((i, index) => <button
          role="tab" id={`illus-tab-${index}`} aria-controls="illus-visual" aria-selected={i.planItemId === s.selectedItem}
          tabIndex={i.planItemId === s.selectedItem ? 0 : -1} key={i.planItemId} onClick={() => c.select(i.planItemId)}
          onKeyDown={(e) => {
            const next = e.key === 'ArrowRight' ? (index + 1) % s.items.length : e.key === 'ArrowLeft' ? (index + s.items.length - 1) % s.items.length : e.key === 'Home' ? 0 : e.key === 'End' ? s.items.length - 1 : -1
            if (next >= 0) { e.preventDefault(); c.select(s.items[next]!.planItemId); (e.currentTarget.parentElement?.children[next] as HTMLElement)?.focus() }
          }}>{i.intent}</button>)}</div>
        <div id="illus-visual" role="tabpanel" aria-label={s.items.find((i) => i.planItemId === record.planItemId)?.intent ?? 'Illustration'}>{renderVisual(record)}</div>
        {s.message && !blocked && <p role="status">{s.message}</p>}
      </>}
      {s.selection?.blockIds.length ? <button onClick={c.selection}>Illustrate selection</button> : null}
    </div>
    <div className="illus-live" role="status" aria-live="polite" aria-atomic="true">{s.announcement}</div>
  </section>
}
