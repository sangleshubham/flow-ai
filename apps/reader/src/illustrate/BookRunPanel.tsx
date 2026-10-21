import type { SectionNode } from '@illus/core'
import React from 'react'

import {
  bookRunBreakdown,
  bookRunEtaMs,
  bookRunPercent,
  bookRunText,
  filterBookRunGroups,
  formatElapsed,
  formatEta,
  groupBookRunSections,
} from './book-run-view'
import type { BookRunFilter, BookRunRow } from './book-run-view'
import type { BookRunState, PaneState } from './state'

export interface BookRunCommands {
  bookConfirm(): void
  bookStart(): void
  bookCancel(): void
  bookPause(): void
  bookResume(): void
  bookRetry(): void
  bookStop(): void
  goToSection(id: string): void
}
const EMPTY_SECTIONS: readonly SectionNode[] = []
const EXPANDED_KEY = 'illus.bookRun.sectionsExpanded'

/** Shared by the pane and Settings; the timer is isolated from the section rows. */
export function BookRunSummary({
  bookRun: b,
  confirmInPane = false,
}: {
  bookRun: BookRunState
  confirmInPane?: boolean
}) {
  const [now, setNow] = React.useState(Date.now)
  const active = [
    'preparing',
    'stopping',
    'understanding',
    'illustrating',
  ].includes(b.status)
  React.useEffect(() => {
    setNow(Date.now())
    if (!active || b.startedAt === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active, b.startedAt])
  const counts = bookRunBreakdown(b)
  const eta = bookRunEtaMs(b)
  return (
    <div className="illus-book-run-summary">
      <h3>Whole-book illustrations</h3>
      <p className="illus-book-run-status" aria-live="polite">
        {confirmInPane && b.status === 'confirm'
          ? 'Confirm the whole-book run in the Illustrate pane.'
          : bookRunText(b)}
      </p>
      {b.message && <p className="illus-book-run-note">{b.message}</p>}
      <BookRunProgress bookRun={b} />
      {b.total > 0 && (
        <>
          {b.status !== 'idle' && (
            <p className="illus-book-run-count">
              {Math.max(b.finished, b.cachedCount)} of {b.total} sections
            </p>
          )}
          <ul
            className="illus-book-run-breakdown"
            aria-label="Section breakdown"
          >
            <li data-status="done">✓ {counts.new} new</li>
            <li data-status="cached">↺ {counts.cached} cached</li>
            <li data-status="no-visual">− {counts.noVisual} no visual</li>
            <li data-status="failed">! {counts.failed} failed</li>
          </ul>
        </>
      )}
      {(b.startedAt !== null || eta !== null) && (
        <p className="illus-book-run-timing">
          {b.startedAt !== null &&
            `${formatElapsed(now - b.startedAt)} elapsed`}
          {eta !== null && (
            <span>
              {b.startedAt !== null ? ' · ' : ''}
              {formatEta(eta)}
            </span>
          )}
        </p>
      )}
    </div>
  )
}

export function BookRunProgress({ bookRun: b }: { bookRun: BookRunState }) {
  const progress =
    b.status === 'preparing'
      ? b.preparing
      : b.status === 'understanding'
      ? { done: b.indexed?.indexed, total: b.indexed?.total }
      : { done: b.finished || b.cachedCount, total: b.total }
  if (!progress && b.status !== 'preparing') return null
  if (
    !progress?.total &&
    b.status !== 'preparing' &&
    b.status !== 'understanding'
  )
    return null
  const known = progress?.total !== undefined && progress.total >= 0
  return (
    <progress
      aria-label={
        b.status === 'preparing'
          ? 'Preparing the book'
          : b.status === 'understanding'
          ? 'Understanding the book'
          : b.status === 'illustrating'
          ? 'Illustrating the book'
          : 'Sections illustrated'
      }
      {...(known
        ? {
            max: Math.max(1, progress.total!),
            value: Math.min(progress.total!, Math.max(0, progress.done ?? 0)),
          }
        : {})}
    />
  )
}

export function BookRunPanel({
  state: s,
  commands: c,
  sections = EMPTY_SECTIONS,
  confirmInPane = false,
  openPane,
}: {
  state: PaneState
  commands: BookRunCommands
  sections?: readonly SectionNode[]
  confirmInPane?: boolean
  openPane?: () => void
}) {
  const b = s.bookRun
  const online = useOnline()
  const working =
    b.status === 'understanding' ||
    b.status === 'illustrating' ||
    b.status === 'stopping'
  const paused = b.status === 'paused' || b.status === 'paused-limit'
  return (
    <div
      className="illus-book-run"
      role="region"
      aria-label="Whole book"
      data-run={b.status}
    >
      <BookRunSummary bookRun={b} confirmInPane={confirmInPane} />
      {b.status === 'confirm' ? (
        confirmInPane ? (
          <div className="illus-book-run-actions">
            {s.open ? (
              <button onClick={c.bookCancel}>Cancel</button>
            ) : (
              <button onClick={openPane}>Open Illustrate pane</button>
            )}
          </div>
        ) : (
          <div className="illus-book-run-confirm">
            <p>
              This uses {b.estimate === null ? 'some' : `about ${b.estimate}`}{' '}
              requests from your ChatGPT plan (the 5-hour window is shared with
              ChatGPT). It runs while this book is open, even with this pane
              closed; the section you’re reading always goes first. If the plan
              limit is reached it pauses until you resume.
            </p>
            <button onClick={c.bookStart}>Start</button>
            <button onClick={c.bookCancel}>Cancel</button>
          </div>
        )
      ) : (
        <div className="illus-book-run-actions">
          {(b.status === 'idle' || (b.status === 'preparing' && !b.queued)) && (
            <button
              onClick={c.bookConfirm}
              disabled={!canStartBookRun(s, online)}
            >
              Illustrate whole book
            </button>
          )}
          {working && <button onClick={c.bookPause}>Pause</button>}
          {paused && <button onClick={c.bookResume}>Resume</button>}
          {b.status === 'error' && <button onClick={c.bookRetry}>Retry</button>}
          {b.status === 'done' && b.failedItems > 0 && (
            <button onClick={c.bookStart}>Retry failed</button>
          )}
          {(working ||
            paused ||
            (b.status === 'preparing' && b.queued !== null)) && (
            <StopControl key={`${s.bookId}:${b.status}`} stop={c.bookStop} />
          )}
        </div>
      )}
      {!confirmInPane && (
        <BookRunSections
          sections={sections}
          bookRun={b}
          navigate={c.goToSection}
        />
      )}
    </div>
  )
}

function StopControl({ stop }: { stop(): void }) {
  const [confirm, setConfirm] = React.useState(false)
  return confirm ? (
    <div className="illus-book-run-stop" role="group" aria-label="Confirm stop">
      <p>Stop the run? Saved illustrations are kept.</p>
      <button
        onClick={() => {
          setConfirm(false)
          stop()
        }}
      >
        Stop run
      </button>
      <button onClick={() => setConfirm(false)}>Keep running</button>
    </div>
  ) : (
    <button onClick={() => setConfirm(true)}>Stop</button>
  )
}

function BookRunSections({
  sections,
  bookRun: b,
  navigate,
}: {
  sections: readonly SectionNode[]
  bookRun: BookRunState
  navigate(id: string): void
}) {
  const [expanded, setExpanded] = React.useState(() => {
    try {
      return localStorage.getItem(EXPANDED_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [filter, setFilter] = React.useState<BookRunFilter>('all')
  const groups = React.useMemo(
    () => groupBookRunSections(sections, b.sections),
    [sections, b.sections],
  )
  const filtered = React.useMemo(
    () => filterBookRunGroups(groups, filter),
    [groups, filter],
  )
  const running = React.useMemo(() => new Set(b.inProgress), [b.inProgress])
  const listId = React.useId()
  return (
    <div className="illus-book-run-sections">
      <button
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => {
          const next = !expanded
          setExpanded(next)
          try {
            localStorage.setItem(EXPANDED_KEY, String(next))
          } catch {
            /* Storage can be unavailable. */
          }
        }}
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> Sections
      </button>
      {expanded && (
        <div id={listId}>
          <div
            className="illus-book-run-filters"
            role="group"
            aria-label="Filter sections"
          >
            {(['all', 'failed', 'pending', 'done'] as const).map((value) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value[0]!.toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          <div
            className="illus-book-run-list"
            aria-label="Run sections"
            role="region"
            tabIndex={0}
          >
            {filtered.length ? (
              filtered.map((group) => (
                <div key={group.id}>
                  <h4>{group.title}</h4>
                  <ul>
                    {group.rows.map((row) => (
                      <SectionRow
                        key={row.id}
                        id={row.id}
                        title={row.title}
                        status={row.status}
                        running={
                          running.has(row.id) || row.status === 'running'
                        }
                        cursor={b.cursor === row.id}
                        navigate={navigate}
                      />
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <p>
                {groups.length
                  ? 'No sections match this filter.'
                  : 'Sections appear when the book is ready.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const STATUS = {
  pending: { icon: '○', text: 'Pending' },
  running: { icon: '◌', text: 'Running' },
  done: { icon: '✓', text: 'Done' },
  cached: { icon: '↺', text: 'Cached' },
  failed: { icon: '!', text: 'Failed' },
  'no-visual': { icon: '−', text: 'No visual' },
}
const SectionRow = React.memo(function SectionRow({
  id,
  title,
  status,
  running,
  cursor,
  navigate,
}: BookRunRow & {
  running: boolean
  cursor: boolean
  navigate(id: string): void
}) {
  return (
    <li
      data-status={status}
      data-running={running || undefined}
      data-cursor={cursor || undefined}
    >
      <button onClick={() => navigate(id)}>
        <span
          aria-hidden="true"
          className={running ? 'illus-run-spinner' : undefined}
        >
          {STATUS[status].icon}
        </span>
        <span className="illus-run-section-title">{title}</span>{' '}
        <span className="illus-run-section-status">
          {STATUS[status].text}
          {cursor ? ' · Resume here' : ''}
        </span>
      </button>
    </li>
  )
})

/** Visible even in the narrow closed rail; text conveys paused/error states without colour. */
export function BookRunBadge({ bookRun: b }: { bookRun: BookRunState }) {
  const paused = b.status === 'paused' || b.status === 'paused-limit'
  const error = b.status === 'error' || b.failedItems > 0
  const preparing =
    b.status === 'preparing' ||
    b.status === 'understanding' ||
    b.status === 'stopping'
  return (
    <span
      className="illus-run-badge"
      data-status={error ? 'failed' : paused ? 'paused' : b.status}
      aria-hidden="true"
    >
      <span>{preparing ? '…' : `${bookRunPercent(b)}%`}</span>
      {paused && <span className="illus-run-dot">Ⅱ</span>}
      {error && (
        <span className="illus-run-dot" data-kind="error">
          !
        </span>
      )}
    </span>
  )
}

/** Tracks network changes for the start button. */
function useOnline(): boolean {
  const [online, setOnline] = React.useState(
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
  )
  React.useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}
function canStartBookRun(s: PaneState, online: boolean): boolean {
  return (
    online && s.status !== 'offline' && !(!s.signedIn && s.signinConfigured)
  )
}
