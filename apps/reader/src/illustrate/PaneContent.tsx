import type { VisualRecord } from '@illus/core'
import React from 'react'
import type { ReactNode } from 'react'

import { catchUpText, PLANNING_TEXT, stageLabel } from './state'
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
export function PaneContent({
  state: s,
  commands: c,
  renderVisual,
}: PaneContentProps) {
  const record =
    s.records.find((r) => r.planItemId === s.selectedItem) ?? s.records[0]
  const caption = s.items.find(
    (i) => i.planItemId === record?.planItemId,
  )?.caption
  const blocked = s.status === 'plan-limit' || s.status === 'signin-required'
  return (
    <section
      className="illus-pane"
      aria-label="Illustrate"
      data-state={s.status}
    >
      <header className="illus-pane-header">
        <div>
          <h2>Illustrate</h2>
          <p className="illus-path">
            {s.section?.headingPath.join(' / ') || 'Your reading companion'}
          </p>
        </div>
        <button
          onClick={c.pin}
          aria-label={s.pinned ? 'Unpin visual' : 'Pin visual'}
          aria-pressed={s.pinned}
        >
          {s.pinned ? 'Unpin' : 'Pin'}
        </button>
        <button onClick={c.close} aria-label="Close Illustrate">
          ×
        </button>
      </header>
      <div className="illus-meta">
        <span>{s.progress || 'Open a book to begin'}</span>
        {s.usage && (
          <span title="Local request caps">
            {s.usage.used5h}/{s.usage.max5h} requests · 5h; {s.usage.usedDay}/
            {s.usage.maxDay} today
          </span>
        )}
      </div>
      <div className="illus-pane-body">
        {s.status === 'idle' && (
          <div className="illus-state">
            <h3>See what you’re reading</h3>
            <p>
              Open a book and navigate to a section. Diagrams link directly to
              their supporting passages.
            </p>
          </div>
        )}
        {s.status === 'indexing-required' && (
          <div className="illus-state">
            <h3>
              {s.estimate ? 'Understand this book' : 'Indexing this book…'}
            </h3>
            <p>
              {s.estimate
                ? `Concept indexing is estimated to use ${
                    s.estimate.requests
                  } index requests and ${s.estimate.tokens.toLocaleString()} input tokens. Summary and glossary calls add a few more requests.`
                : 'Preparing section boundaries and passages on this device.'}
            </p>
            {s.estimate && (
              <button onClick={c.approve}>Start indexing and illustrate</button>
            )}
          </div>
        )}
        {s.status === 'planning' && (
          <div className="illus-state" aria-busy="true">
            <p>{PLANNING_TEXT}</p>
            <div className="illus-skeleton" />
          </div>
        )}
        {s.status === 'generating' && (
          <div aria-busy="true">
            {s.items.map((i) => (
              <div className="illus-state" key={i.planItemId}>
                <h3>{i.intent}</h3>
                {i.planItemId in s.catchingUp && (
                  <p className="illus-catch-up">
                    {catchUpText(s.catchingUp[i.planItemId]!)}
                  </p>
                )}
                <div className="illus-skeleton" />
                <p className="illus-stage" aria-live="polite">
                  {stageLabel(s.stages[i.planItemId])}
                </p>
              </div>
            ))}
          </div>
        )}
        {s.status === 'no-visual' && (
          <div className="illus-state">
            <h3>No diagram needed</h3>
            <p>{s.reason}</p>
            <button onClick={c.force}>Illustrate anyway</button>
            {s.previousSectionId && (
              <button onClick={c.previous}>Previous section’s visual</button>
            )}
          </div>
        )}
        {s.status === 'error' && (
          <div className="illus-state" role="alert">
            <h3>Couldn’t finish this illustration</h3>
            <p>{s.message}</p>
            <button onClick={c.retry}>Retry</button>
            <button onClick={c.report}>Report</button>
          </div>
        )}
        {blocked && (
          <div className="illus-state" role="alert">
            <h3>
              {s.status === 'plan-limit'
                ? 'Plan requests are paused'
                : s.signinConfigured
                ? 'Connect your ChatGPT account'
                : 'ChatGPT sign-in is not configured'}
            </h3>
            <p>
              {s.status === 'signin-required' && !s.signinConfigured
                ? 'This server has no ChatGPT sign-in set up, so new illustrations cannot be generated. Your cached illustrations remain available.'
                : s.message || 'Your cached illustrations remain available.'}
            </p>
            {s.usage?.pausedUntil && (
              <p>Resets {new Date(s.usage.pausedUntil).toLocaleString()}.</p>
            )}
            {s.status === 'plan-limit' ? (
              <a
                href="https://chatgpt.com/#settings"
                target="_blank"
                rel="noreferrer"
              >
                ChatGPT Settings › Usage
              </a>
            ) : (
              s.signinConfigured && (
                <a className="illus-button" href="/auth/chatgpt/start">
                  Continue with ChatGPT
                </a>
              )
            )}
            <button onClick={c.retry}>Retry</button>
          </div>
        )}
        {s.status === 'offline' && (
          <div className="illus-state" role="status">
            <h3>You’re offline</h3>
            <p>
              {record
                ? 'Showing an illustration saved on this device.'
                : 'There is no saved illustration for this section. Reconnect to generate one.'}
            </p>
          </div>
        )}
        {(s.status === 'ready' || s.status === 'offline' || blocked) && record && (
          <>
            {s.overview && <p className="illus-overview">{s.overview}</p>}
            <div
              className="illus-tabs"
              role="tablist"
              aria-label="Illustrations"
            >
              {s.items.map((i, index) => (
                <button
                  role="tab"
                  id={`illus-tab-${index}`}
                  aria-controls="illus-visual"
                  aria-selected={i.planItemId === s.selectedItem}
                  tabIndex={i.planItemId === s.selectedItem ? 0 : -1}
                  key={i.planItemId}
                  onClick={() => c.select(i.planItemId)}
                  onKeyDown={(e) => {
                    const next =
                      e.key === 'ArrowRight'
                        ? (index + 1) % s.items.length
                        : e.key === 'ArrowLeft'
                        ? (index + s.items.length - 1) % s.items.length
                        : e.key === 'Home'
                        ? 0
                        : e.key === 'End'
                        ? s.items.length - 1
                        : -1
                    if (next >= 0) {
                      e.preventDefault()
                      c.select(s.items[next]!.planItemId)
                      ;(
                        e.currentTarget.parentElement?.children[
                          next
                        ] as HTMLElement
                      )?.focus()
                    }
                  }}
                >
                  {i.intent}
                </button>
              ))}
            </div>
            <div
              id="illus-visual"
              role="tabpanel"
              aria-label={
                s.items.find((i) => i.planItemId === record.planItemId)
                  ?.intent ?? 'Illustration'
              }
            >
              {caption && <p className="illus-caption">{caption}</p>}
              <QualityWarning record={record} />
              {renderVisual(record)}
            </div>
            {s.message && !blocked && <p role="status">{s.message}</p>}
          </>
        )}
        {s.selection?.blockIds.length ? (
          <button onClick={c.selection}>Illustrate selection</button>
        ) : null}
      </div>
      <div
        className="illus-live"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {s.announcement}
      </div>
    </section>
  )
}

/**
 * §16 L4/L5 (ADR 0043): render-check findings are warnings and a failing critic report stays on the
 * record; flag either with the warning badge, never hide the visual.
 */
export function QualityWarning({ record }: { record: VisualRecord }) {
  const failed = record.critic?.pass === false
  const notes = [
    ...(failed ? record.critic!.issues.map((i) => i.note) : []),
    ...record.validation.issues
      .filter((i) => i.layer === 'render')
      .map((i) => i.message),
  ]
  if (!failed && !notes.length) return null
  return (
    <details className="illus-quality-warning" data-testid="quality-warning">
      <summary>
        <span className="illus-warning-badge" role="img" aria-label="Warning">
          !
        </span>{' '}
        {failed
          ? 'Quality review flagged this visual'
          : 'Layout checks found issues'}
      </summary>
      {notes.length > 0 && (
        <ul>
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </details>
  )
}
