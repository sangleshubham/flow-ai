import React, { useEffect } from 'react'
import { useSnapshot } from 'valtio'

import { useSplitViewItem } from '../components/base'
import { reader, useReaderSnapshot } from '../models'

import { PaneContent } from './PaneContent'
import { RecordView } from './RecordView'
import { activate, approveIndexing, deactivate, goPrevious, illustrateSelection, loadPreferences, networkChanged, reportError, requestVisual, setPinned, togglePane } from './runtime'
import { pane } from './state'
import type { PaneState } from './state'

export function IllustratePane() {
  const s = useSnapshot(pane) as unknown as PaneState
  const r = useReaderSnapshot()
  const { size } = useSplitViewItem('IllustratePane', { preferredSize: typeof window === 'undefined' ? 560 : Math.round(window.innerWidth * 0.45), minSize: 320, visible: s.open })
  useEffect(() => { void loadPreferences().catch((e) => { pane.message = e.message }) }, [])
  useEffect(() => {
    const tab = reader.focusedBookTab
    if (s.open && tab?.rendition && tab.epub) void activate(tab as any)
    else { deactivate(); if (!pane.pinned) pane.status = 'idle' }
    return deactivate
  }, [r.focusedBookTab?.id, r.focusedBookTab?.rendition, s.open])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'i') { e.preventDefault(); togglePane() }
      if (e.key === 'Escape' && pane.open && !e.defaultPrevented) { pane.open = false }
    }
    window.addEventListener('keydown', key); window.addEventListener('online', networkChanged); window.addEventListener('offline', networkChanged)
    const rendition = reader.focusedBookTab?.rendition
    const documents = new Set<Document>()
    const attach = () => rendition?.getContents().forEach((contents) => { if (!documents.has(contents.document)) { contents.document.addEventListener('keydown', key); documents.add(contents.document) } })
    rendition?.on('rendered', attach); attach()
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('online', networkChanged); window.removeEventListener('offline', networkChanged); rendition?.off('rendered', attach); documents.forEach((doc) => doc.removeEventListener('keydown', key)) }
  }, [r.focusedBookTab?.rendition])
  if (!s.open) return <button className="illus-toggle" onClick={togglePane} aria-label="Open Illustrate" aria-keyshortcuts="Alt+I">Illustrate</button>
  return <div className="illus-pane-slot" style={{ width: size }}>
    <PaneContent state={s} commands={{ close: togglePane, pin: () => { void setPinned(!pane.pinned) }, approve: () => { void approveIndexing() }, retry: () => requestVisual(),
      force: () => requestVisual({ force: true }), report: () => { void reportError() }, previous: () => { void goPrevious() }, selection: illustrateSelection,
      select: (id) => { pane.selectedItem = id }, now: () => requestVisual() }} renderVisual={(record) => <RecordView key={record.cacheKey} record={record} />} />
  </div>
}
