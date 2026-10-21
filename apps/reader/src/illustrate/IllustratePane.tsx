import React, { useEffect } from 'react'
import { useSnapshot } from 'valtio'

import { useSplitViewItem } from '../components/base'
import { reader, useReaderSnapshot } from '../models'

import { BookRunBadge } from './BookRunPanel'
import { PaneContent } from './PaneContent'
import { RecordView } from './RecordView'
import { bookRunText } from './book-run-view'
import {
  activate,
  activeSections,
  approveIndexing,
  cancelBookRunConfirm,
  confirmBookRun,
  deactivate,
  goPrevious,
  goToSection,
  illustrateSelection,
  loadPreferences,
  networkChanged,
  paneClosed,
  paneOpened,
  pauseBookRun,
  reportError,
  requestVisual,
  retryVisual,
  resumeBookRun,
  retryActivate,
  setPinned,
  startBookRun,
  stopBookRun,
  togglePane,
} from './runtime'
import { pane } from './state'
import type { PaneState } from './state'

const navigateToSection = (id: string) => {
  void goToSection(id)
}

export function IllustratePane() {
  const s = useSnapshot(pane) as unknown as PaneState
  const r = useReaderSnapshot()
  const { size } = useSplitViewItem('IllustratePane', {
    preferredSize:
      typeof window === 'undefined'
        ? 560
        : Math.round(window.innerWidth * 0.45),
    minSize: 320,
    visible: s.open,
  })
  useEffect(() => {
    void loadPreferences().catch((e) => {
      pane.message = e.message
    })
  }, [])
  // ADR 0057: the runtime lives while the pane is open, or while the focused book's whole-book run
  // is running (even with the pane closed). Opening and closing the pane over it only resets the
  // reader's own section work.
  const focusedBookId = r.focusedBookTab?.book.id
  const keepAlive =
    s.open || (!!focusedBookId && s.runningBooks.includes(focusedBookId))
  useEffect(() => {
    const tab = reader.focusedBookTab
    if (keepAlive && tab?.rendition && tab.epub) void activate(tab as any)
    else {
      deactivate()
      if (!pane.pinned) pane.status = 'idle'
    }
    return deactivate
  }, [r.focusedBookTab?.id, r.focusedBookTab?.rendition, keepAlive])
  useEffect(() => {
    if (!s.open) return paneClosed()
    // Over a live runtime this only reopens the pane (`activate` is idempotent per tab). It also retries
    // an activation that failed while the pane was closed, which the effect above would not redo.
    const tab = reader.focusedBookTab
    if (tab?.rendition && tab.epub) void activate(tab as any)
    else paneOpened()
  }, [s.open])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        togglePane()
      }
      if (e.key === 'Escape' && pane.open && !e.defaultPrevented) {
        pane.open = false
      }
    }
    window.addEventListener('keydown', key)
    window.addEventListener('online', networkChanged)
    window.addEventListener('offline', networkChanged)
    const rendition = reader.focusedBookTab?.rendition
    const documents = new Set<Document>()
    const attach = () =>
      rendition?.getContents().forEach((contents) => {
        if (!documents.has(contents.document)) {
          contents.document.addEventListener('keydown', key)
          documents.add(contents.document)
        }
      })
    rendition?.on('rendered', attach)
    attach()
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('online', networkChanged)
      window.removeEventListener('offline', networkChanged)
      rendition?.off('rendered', attach)
      documents.forEach((doc) => doc.removeEventListener('keydown', key))
    }
  }, [r.focusedBookTab?.rendition])
  // Closed, the toggle is an in-flow rail beside the book, so it never covers Flow's own top-bar buttons.
  if (!s.open) {
    if (!r.focusedBookTab) return null
    const b = s.bookRun
    const showRun = !!s.bookId && s.preferences.flags.wholeBook
    const label = showRun
      ? `Open Illustrate. ${bookRunText(b)}${b.message ? ` ${b.message}` : ''}`
      : 'Open Illustrate'
    return (
      <div className="illus-rail">
        <button
          className="illus-toggle"
          onClick={togglePane}
          aria-label={label}
          title={label}
          aria-keyshortcuts="Alt+I"
        >
          <span className="illus-toggle-label">Illustrate</span>
          {showRun && <BookRunBadge bookRun={b} />}
        </button>
      </div>
    )
  }

  return (
    <div className="illus-pane-slot" style={{ width: size }}>
      <PaneContent
        state={s}
        sections={activeSections()}
        commands={{
          close: togglePane,
          pin: () => {
            void setPinned(!pane.pinned)
          },
          approve: () => {
            void approveIndexing()
          },
          retry: retryVisual,
          force: () => requestVisual({ force: true }),
          report: () => {
            void reportError()
          },
          previous: () => {
            void goPrevious()
          },
          selection: illustrateSelection,
          select: (id) => {
            pane.selectedItem = id
          },
          now: () => requestVisual(),
          bookConfirm: () => {
            void confirmBookRun()
          },
          bookStart: () => {
            void startBookRun()
          },
          bookCancel: cancelBookRunConfirm,
          bookPause: pauseBookRun,
          bookResume: () => {
            void resumeBookRun()
          },
          bookStop: () => {
            void stopBookRun()
          },
          goToSection: navigateToSection,
          bookRetry: () => {
            void retryActivate()
          },
        }}
        renderVisual={(record) => (
          <RecordView key={record.cacheKey} record={record} />
        )}
      />
    </div>
  )
}
