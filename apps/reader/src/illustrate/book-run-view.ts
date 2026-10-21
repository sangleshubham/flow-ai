import type { SectionNode } from '@illus/core'
import { BOOK_RUN_SECTIONS } from '@illus/pipeline'

import type { BookRunState } from './state'

export type RunSectionStatus = BookRunState['sections'][string]
export type BookRunFilter = 'all' | 'failed' | 'pending' | 'done'
export interface BookRunRow {
  id: string
  title: string
  status: RunSectionStatus
}
export interface BookRunGroup {
  id: string
  title: string
  rows: BookRunRow[]
}

export function bookRunBreakdown(b: BookRunState) {
  const counts = {
    new: 0,
    cached: 0,
    noVisual: 0,
    failed: 0,
    pending: 0,
    running: 0,
  }
  const states = Object.values(b.sections)
  if (!states.length) {
    counts.cached = Math.max(0, b.cachedCount - b.noVisual)
    counts.noVisual = b.noVisual
    counts.new = Math.max(0, b.finished - b.cachedCount)
    counts.pending = Math.max(0, b.total - Math.max(b.finished, b.cachedCount))
    return counts
  }
  for (const status of states) {
    if (status === 'done') counts.new++
    else if (status === 'no-visual') counts.noVisual++
    else counts[status]++
  }
  return counts
}

/** ADR 0064: cached sections never contribute to the session mean or its two-section minimum. */
export function bookRunEtaMs(b: BookRunState): number | null {
  const session = b.session
  if (
    b.status !== 'illustrating' ||
    !session ||
    session.done < 2 ||
    session.avgSectionMs === null ||
    !Number.isFinite(session.avgSectionMs) ||
    session.avgSectionMs <= 0
  )
    return null
  return (
    (session.avgSectionMs * bookRunBreakdown(b).pending) / BOOK_RUN_SECTIONS
  )
}

export const bookRunPercent = (b: Pick<BookRunState, 'finished' | 'total'>) =>
  b.total > 0
    ? Math.max(0, Math.min(100, Math.round((100 * b.finished) / b.total)))
    : 0

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds >= 3600)
    return `${Math.floor(seconds / 3600)} h ${
      Math.floor(seconds / 60) % 60
    } min`
  if (seconds >= 60) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`
  return `${seconds} s`
}
export function formatEta(ms: number): string {
  return ms < 60_000
    ? 'less than a minute left'
    : `about ${Math.ceil(ms / 60_000)} min left`
}

/** The runtime returns a flat section tree; only ids in the run map are generation targets. */
export function groupBookRunSections(
  sections: readonly SectionNode[],
  targets: BookRunState['sections'],
): BookRunGroup[] {
  const byId = new Map(sections.map((s) => [s.sectionId, s]))
  const roots = new Map<string, SectionNode>()
  const rootOf = (section: SectionNode) => {
    const path: SectionNode[] = []
    const seen = new Set<string>()
    let root = section
    while (!seen.has(root.sectionId)) {
      seen.add(root.sectionId)
      path.push(root)
      const cached = roots.get(root.sectionId)
      if (cached) {
        root = cached
        break
      }
      const parent = root.parentId ? byId.get(root.parentId) : undefined
      if (!parent) break
      root = parent
    }
    path.forEach((s) => roots.set(s.sectionId, root))
    return root
  }
  const groups = new Map<string, BookRunGroup>()
  const ids = Object.keys(targets).sort(
    (a, b) =>
      (byId.get(a)?.ordinal ?? Infinity) - (byId.get(b)?.ordinal ?? Infinity),
  )
  for (const id of ids) {
    const section = byId.get(id)
    const root = section && rootOf(section)
    const groupId = root?.sectionId ?? '__unknown__'
    let group = groups.get(groupId)
    if (!group) {
      group = {
        id: groupId,
        title: root ? root.title || root.sectionId : 'Other sections',
        rows: [],
      }
      groups.set(groupId, group)
    }
    group.rows.push({ id, title: section?.title || id, status: targets[id]! })
  }
  return [...groups.values()]
}

export function filterBookRunGroups(
  groups: BookRunGroup[],
  filter: BookRunFilter,
): BookRunGroup[] {
  if (filter === 'all') return groups
  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter(({ status }) =>
        filter === 'pending'
          ? status === 'pending' || status === 'running'
          : filter === 'done'
          ? status === 'done' || status === 'cached' || status === 'no-visual'
          : status === 'failed',
      ),
    }))
    .filter((group) => group.rows.length > 0)
}

function resetTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** The whole-book status as one sentence (ADR 0057, ADR 0064); the pane bar and the settings share it. */
export function bookRunText(b: BookRunState): string {
  switch (b.status) {
    case 'preparing': {
      const p = b.preparing
      const step = p
        ? `: ${p.label}${
            p.done !== undefined && p.total !== undefined
              ? ` ${p.done} / ${p.total}`
              : ''
          }`
        : ''
      return `Preparing the book${step}…${
        b.queued ? ' Will start when the book is ready.' : ''
      }`
    }
    case 'stopping':
      return 'Stopping the previous run…'
    case 'error':
      return 'The book could not be prepared.'
    case 'idle':
      return b.total
        ? `${b.cachedCount} of ${b.total} sections illustrated`
        : 'Preparing the book…'
    case 'confirm':
      return `Illustrate the remaining ${Math.max(
        0,
        b.total - b.cachedCount,
      )} sections?`
    case 'understanding':
      return b.indexed
        ? `Understanding the book: ${b.indexed.indexed} of ${b.indexed.total} sections`
        : 'Understanding the book…'
    case 'illustrating':
      return `Illustrating book: ${b.finished} / ${b.total}${
        b.failedItems > 0 ? ` · ${b.failedItems} items failed` : ''
      }`
    case 'paused':
      return `Paused at ${b.finished} / ${b.total}`
    case 'paused-limit':
      return `Paused after an OpenAI usage-limit error.${
        b.resetAt ? ` Local pause until ${resetTime(b.resetAt)}.` : ''
      } Resume checks your access again.`
    case 'done':
      return `Book illustrated${
        b.failedItems > 0 ? ` · ${b.failedItems} items failed` : ''
      }`
  }
}
