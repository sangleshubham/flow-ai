import { buildLexicalIndex, indexBookStructure } from '@illus/book-index'
import {
  createConceptPass,
  estimateIndexUsage,
  withLayout,
} from '@illus/concepts'
import type { ConceptPass } from '@illus/concepts'
import {
  IR,
  makeBookId,
  resolveFlags,
  validateAnimation,
  VisualKind,
} from '@illus/core'
import type {
  Block,
  IllusRepos,
  LayoutGraphResult,
  ReaderLocation,
  SectionNode,
  VisualRecord,
} from '@illus/core'
import {
  createLlmClient,
  createPromptRegistry,
  DEFAULT_MODELS,
  httpTransport,
} from '@illus/llm'
import { createPipeline } from '@illus/pipeline'
import type { Pipeline, RequestOptions, SectionJob } from '@illus/pipeline'
import { createReaderBridge } from '@illus/reader-bridge'
import type { BridgeRendition, ManagedReaderBridge } from '@illus/reader-bridge'
import { readFlowTheme, reviewHook, templateRegistry } from '@illus/render'
import type { EvidenceEvent } from '@illus/render'
import {
  createDexieRepos,
  exportCache,
  importCache,
  openIllusDb,
  requestPersistence,
} from '@illus/store'
import {
  createBrowserTraceWorker,
  createTraceRunner,
  TRACER_VERSION,
} from '@illus/tracer'
import { z } from 'zod'

import type { Book } from '@flow/epubjs'

import { db } from '../db'

import { PROMPT_FILES } from './prompt-files'
import {
  bindJob,
  createDwell,
  DEFAULT_PREFERENCES,
  dwellDelay,
  evidenceAction,
  pane,
  migrateDwellMs,
  parseDwellMs,
  PREFS_VERSION,
  whenCritic,
} from './state'
import type { Preferences } from './state'

// Zod's compiled fast path uses new Function; the strict production CSP forbids it.
z.config({ jitless: true })

interface BookTabLike {
  book: { id: string }
  epub?: Book
  rendition?: BridgeRendition
}
let reposPromise: Promise<IllusRepos> | undefined
export const getRepos = () =>
  (reposPromise ??= Promise.resolve().then(() =>
    createDexieRepos(openIllusDb()),
  ))
const prompts = createPromptRegistry(PROMPT_FILES)
let active: {
  bridge: ManagedReaderBridge
  pipeline: Pipeline
  concepts: ConceptPass
  sections: SectionNode[]
  blocks: Block[]
  book: Book
  bookId: string
} | null = null
let currentJob: SectionJob | null = null
let unbind: (() => void) | undefined
let generation = 0
// Per kind, so a step clearing its mark never cancels an in-flight evidence click.
const evidenceGeneration = { evidence: 0, step: 0 }
const pinnedEvidence = { evidence: false, step: false }
let locationId: string | null = null
/** The section the pane last set itself up for; a repeated location for it changes nothing. */
let shownSectionId: string | null | undefined
// ADR 0048: a new section waits for the reader to stay before any model call.
const dwell = createDwell()
let lastBook: { book: Book; bookId: string } | null = null
let traceWorker: ReturnType<typeof createBrowserTraceWorker> | undefined
let traceRunner: ReturnType<typeof createTraceRunner> | undefined
function getTraceRunner() {
  traceWorker ??= createBrowserTraceWorker()
  return (traceRunner ??= createTraceRunner({ worker: traceWorker }))
}
let disposers: (() => void)[] = []
/** ADR 0010: default when the `indexConfirmThresholdTokens` setting is absent. */
export const INDEX_CONFIRM_THRESHOLD_TOKENS = 200_000

export async function loadPreferences() {
  const repos = await getRepos()
  const saved = await repos.settings.get<
    Partial<Preferences> & { prefsVersion?: number }
  >('illustratePreferences')
  // Treat persisted/imported settings as untrusted input.
  const p = saved ?? {}
  pane.preferences = {
    enabled: p.enabled === true,
    autoHighlight: p.autoHighlight !== false,
    highlightSteps: p.highlightSteps !== false,
    speed:
      typeof p.speed === 'number' && [0.5, 1, 1.5, 2].includes(p.speed)
        ? p.speed
        : 1,
    reducedMotion:
      p.reducedMotion === 'on' || p.reducedMotion === 'off'
        ? p.reducedMotion
        : 'system',
    debugPrompts: p.debugPrompts === true,
    dwellMs: migrateDwellMs(p),
    flags: resolveFlags(p.flags),
  }
  pane.open = pane.preferences.enabled
  await requestPersistence(repos.settings, navigator.storage)
  await refreshUsage()
}
export async function savePreferences(next: Preferences) {
  pane.preferences = {
    ...DEFAULT_PREFERENCES,
    ...next,
    dwellMs: parseDwellMs(next.dwellMs),
    flags: resolveFlags(next.flags),
  }
  await (
    await getRepos()
  ).settings.set(
    'illustratePreferences',
    JSON.parse(
      JSON.stringify({ ...pane.preferences, prefsVersion: PREFS_VERSION }),
    ),
  )
}
export function togglePane() {
  pane.open = !pane.open
  void savePreferences({ ...pane.preferences, enabled: pane.open })
}
export async function refreshUsage() {
  try {
    const usage = await fetch('/api/llm/usage', { cache: 'no-store' })
    if (!usage.ok) return
    const body = await usage.json()
    pane.usage = body
    const account = await fetch('/auth/chatgpt/status', { cache: 'no-store' })
    if (account.ok) {
      const status = await account.json()
      pane.signinConfigured = status.configured !== false
      pane.signedIn = status.signedIn === true
      pane.account = !pane.signinConfigured
        ? body.mode === 'replay'
          ? 'Replay mode: no ChatGPT account needed'
          : 'ChatGPT sign-in is not configured on this server'
        : status.signedIn
        ? `Signed in as ${status.email ?? status.sub}`
        : 'Reader session active; connect ChatGPT for plan usage'
    } else {
      pane.signedIn = false
      pane.account = 'ChatGPT sign-in is unavailable on this server'
    }
  } catch {
    /* Offline cached reading remains available. */
  }
}
export function deactivate() {
  generation++
  evidenceGeneration.evidence++
  evidenceGeneration.step++
  pinnedEvidence.evidence = pinnedEvidence.step = false
  dwell.cancel()
  currentJob?.cancel()
  unbind?.()
  unbind = undefined
  disposers.forEach((fn) => fn())
  disposers = []
  active?.concepts.pause()
  active?.bridge.dispose()
  active = null
  currentJob = null
  locationId = null
  shownSectionId = undefined
}
export async function activate(tab: BookTabLike) {
  deactivate()
  const own = generation
  if (!tab.epub || !tab.rendition) {
    pane.status = 'idle'
    return
  }
  const book = tab.epub
  const rendition = tab.rendition
  pane.status = 'indexing-required'
  pane.progress = 'Preparing the book index…'
  try {
    const file = await db?.files.get(tab.book.id)
    if (!file)
      throw new Error(
        'The EPUB file is unavailable. Re-open it from the library.',
      )
    const bookId = await makeBookId(
      new Uint8Array(await file.file.arrayBuffer()),
    )
    const repos = await getRepos()
    if (own !== generation) return
    pane.bookId = bookId
    lastBook = { book, bookId }
    for await (const p of indexBookStructure(book, repos, { bookId })) {
      if (own !== generation) return
      pane.progress =
        p.phase === 'done'
          ? `${p.sectionCount} sections indexed`
          : `Indexing book: ${p.spineDone} of ${p.spineTotal}`
    }
    const sections = await repos.sections.listByBook(bookId)
    const blocks = (
      await Promise.all(
        sections.map((s) => repos.blocks.listBySection(s.sectionId)),
      )
    ).flat()
    if (own !== generation) return
    const bridge = createReaderBridge({
      bookId,
      rendition,
      sections: () => sections,
      blocks: () => blocks,
    })
    const llm = createLlmClient({
      transport: httpTransport(),
      prompts,
      log: repos.llmLog,
      debugPrompts: () => pane.preferences.debugPrompts,
    })
    const concepts = createConceptPass({
      bookId,
      repos,
      llm,
      onProgress(p) {
        if (own === generation)
          pane.progress = `${p.indexed} of ${p.total} sections understood`
      },
    })
    const pipeline = createPipeline({
      repos,
      llm,
      prompts,
      models: DEFAULT_MODELS,
      concepts,
      flags: () => pane.preferences.flags,
      lexical: buildLexicalIndex(blocks, sections),
      templates: templateRegistry,
      // §16 L4 render checks, L5 critic and repair (W10), gated per visual by the `critic` flag.
      review: whenCritic(
        () => pane.preferences.flags.critic,
        (record, ctx) =>
          reviewHook({
            llm,
            theme: readFlowTheme(),
            templates: templateRegistry,
          })(record, ctx),
      ),
      traceRunner: {
        runTrace: (input, opts) => getTraceRunner().runTrace(input, opts),
      },
      tracerVersion: TRACER_VERSION,
      validateAnimation: (ir, animation, context) => {
        const parsed = IR.safeParse(ir)
        return parsed.success
          ? validateAnimation(parsed.data, animation, {
              templates: templateRegistry,
              grounding: { blocks: context.blocks },
            }).issues
          : [
              {
                layer: 'animation',
                severity: 'error',
                code: 'animation-base-ir',
                message: 'Invalid base visual.',
              },
            ]
      },
    })
    active = { bridge, pipeline, concepts, sections, blocks, book, bookId }
    const indexed = new Set(
      (await repos.sectionIndex.listByBook(bookId)).map((s) => s.sectionId),
    )
    const threshold = await repos.settings.get<number>(
      'indexConfirmThresholdTokens',
    )
    const estimate = estimateIndexUsage(
      sections.filter((s) => !indexed.has(s.sectionId)),
      {
        indexConfirmThresholdTokens:
          typeof threshold === 'number' && threshold >= 0
            ? threshold
            : INDEX_CONFIRM_THRESHOLD_TOKENS,
        maxRequests5h: 100,
      },
    )
    pane.estimate = {
      requests: estimate.requests,
      tokens: estimate.inputTokens,
    }
    // §6 phase B step 8: ask only above the threshold.
    pane.indexingApproved =
      !estimate.needsConfirm ||
      (await repos.books.get(bookId))?.indexStatus === 'complete' ||
      (await repos.settings.get<boolean>(`indexingApproved:${bookId}`)) === true
    disposers.push(
      bridge.onLocationChange((loc) => {
        void onLocation(loc, own)
      }),
      bridge.onSelection((sel) => {
        pane.selection = sel
      }),
    )
    bridge.refreshLocation()
  } catch (e) {
    if (own === generation) {
      pane.status = 'error'
      pane.message = (e as Error).message
    }
  }
}
async function onLocation(loc: ReaderLocation, own: number) {
  if (own !== generation || !active) return
  locationId = loc.sectionId
  // A click that turns to evidence re-publishes the section the reader is already on (the bridge
  // resets its de-duplication for every explicit navigation); re-running would reset the open plan item
  // and cancel the job in progress.
  if (
    !pane.pinned &&
    loc.sectionId !== null &&
    loc.sectionId === shownSectionId
  )
    return
  pane.selection = null
  if (pane.pinned) return
  shownSectionId = loc.sectionId
  dwell.cancel()
  const old = pane.section
  pane.section =
    active.sections.find((s) => s.sectionId === loc.sectionId) ?? null
  if (old && old.sectionId !== loc.sectionId && pane.records.length)
    pane.previousSectionId = old.sectionId
  if (old?.sectionId !== loc.sectionId) {
    // The reader moved on: stop spending requests on the section they left.
    currentJob?.cancel()
    unbind?.()
    unbind = undefined
    currentJob = null
    pane.records = []
    pane.previews = {}
    pane.items = []
    pane.selectedItem = ''
  }
  if (!pane.section) {
    pane.status = 'idle'
    return
  }
  active.concepts.setOpenSection(pane.section.sectionId)
  const cachedPlan = await showCached()
  if (own !== generation || pane.section?.sectionId !== loc.sectionId) return
  if (!navigator.onLine || !pane.indexingApproved) {
    pane.status = !navigator.onLine
      ? 'offline'
      : pane.records.length
      ? 'ready'
      : 'indexing-required'
    return
  }
  const wait = dwellDelay({
    cachedPlan,
    dwellMs: pane.preferences.dwellMs,
  })
  if (!wait) return requestVisual()
  const sectionId = loc.sectionId
  pane.status = 'waiting'
  pane.dwellUntil = Date.now() + wait
  dwell.start(wait, () => {
    if (
      own === generation &&
      pane.status === 'waiting' &&
      pane.section?.sectionId === sectionId
    )
      requestVisual()
  })
}
export async function approveIndexing() {
  if (!active) return
  pane.indexingApproved = true
  await (
    await getRepos()
  ).settings.set(`indexingApproved:${active.bookId}`, true)
  requestVisual()
}
export function requestVisual(opts: RequestOptions = {}) {
  dwell.cancel()
  if (!active || !pane.section || !pane.open) return
  if (!navigator.onLine) {
    void showCached().then(() => {
      pane.status = 'offline'
    })
    return
  }
  const runtime = active
  currentJob?.cancel()
  unbind?.()
  const job = runtime.pipeline.requestSection(pane.section.sectionId, opts)
  currentJob = job
  unbind = bindJob(
    pane,
    job,
    () => currentJob === job && active === runtime,
    () => {
      void refreshUsage()
    },
  )
}
export function illustrateSelection() {
  if (!active || !locationId || !pane.selection?.blockIds.length) return
  dwell.cancel()
  currentJob?.cancel()
  unbind?.()
  const runtime = active
  const job = runtime.pipeline.requestSelection({
    parentSectionId: locationId,
    blockIds: [...pane.selection.blockIds],
  })
  currentJob = job
  unbind = bindJob(
    pane,
    job,
    () => currentJob === job && active === runtime,
    () => {
      void refreshUsage()
    },
  )
}
export function unpin() {
  pane.pinned = false
  active?.bridge.refreshLocation()
}
export async function setPinned(pinned: boolean) {
  if (!pinned) unpin()
  else pane.pinned = true
  for (const r of pane.records) await updateRecord({ ...r, pinned })
}
/** Shows the section's saved plan and visuals; true when a plan was saved. */
export async function showCached(): Promise<boolean> {
  if (!active || !pane.section) return false
  const section = pane.section
  const runtime = active
  const repos = await getRepos()
  const [records, plans] = await Promise.all([
    repos.visuals.listBySection(runtime.bookId, section.sectionId),
    repos.plans.listBySection(runtime.bookId, section.sectionId),
  ])
  if (active !== runtime || pane.section?.sectionId !== section.sectionId)
    return false
  const latest = new Map<string, VisualRecord>()
  for (const r of records.sort((a, b) => a.createdAt - b.createdAt))
    latest.set(r.planItemId, r)
  pane.records = [...latest.values()]
  pane.items =
    plans.sort((a, b) => b.createdAt - a.createdAt)[0]?.plan.items ?? []
  pane.selectedItem =
    pane.items[0]?.planItemId ?? pane.records[0]?.planItemId ?? ''
  return plans.length > 0
}
export function networkChanged() {
  if (!navigator.onLine) {
    currentJob?.cancel()
    void showCached().then(() => {
      pane.status = 'offline'
    })
  } else if (pane.status === 'offline') requestVisual()
}
export function currentBridge() {
  return active?.bridge
}
export const activeSections = (): readonly SectionNode[] =>
  active?.sections ?? []
/** §13 layout stability: merge the rendered positions into the stored model (fresh read, so a concurrent patch is kept). */
export async function saveConceptLayout(
  conceptModelId: string,
  layout: LayoutGraphResult,
) {
  const repos = await getRepos()
  await repos.transaction(['conceptModels'], async () => {
    const model = await repos.conceptModels.get(conceptModelId)
    if (model) await repos.conceptModels.put(withLayout(model, layout))
  })
}
export async function highlightEvidence(
  event: EvidenceEvent | null,
  click = false,
  kind: 'evidence' | 'step' = 'evidence',
) {
  if (
    evidenceAction({
      hasEvent: !!event,
      click,
      autoHighlight: kind === 'step' ? true : pane.preferences.autoHighlight,
      pinned: pinnedEvidence[kind],
    }) === 'ignore'
  )
    return
  const seq = ++evidenceGeneration[kind]
  const runtime = active
  if (!runtime) return
  runtime.bridge.clearHighlights(kind)
  pinnedEvidence[kind] = click && !!event
  if (!event) return
  const block = runtime.blocks.find((b) => b.blockId === event.evidence.blockId)
  if (!block) {
    pane.announcement =
      'Open the book for this pinned visual to show its evidence.'
    return
  }
  let cfi = await runtime.bridge.quoteToCfi(block.blockId, event.evidence.quote)
  if (seq !== evidenceGeneration[kind] || active !== runtime) return
  if (click) {
    // Decision 2026-10-16: playback never moves the book; an explicit click always shows the passage.
    await runtime.bridge.scrollTo(cfi ?? block.cfiRange)
    if (seq !== evidenceGeneration[kind] || active !== runtime) return
    if (!cfi)
      cfi = await runtime.bridge.quoteToCfi(block.blockId, event.evidence.quote)
  }
  if (seq !== evidenceGeneration[kind] || active !== runtime) return
  if (cfi) runtime.bridge.highlight(cfi, kind)
  pane.announcement = `${event.label}. Evidence: ${event.evidence.quote}${
    cfi ? '' : ' (passage unavailable in this view)'
  }`
}
export async function updateRecord(record: VisualRecord) {
  // Snapshot/proxy data is converted to plain data for Dexie's structured clone.
  const plain = JSON.parse(JSON.stringify(record)) as VisualRecord
  await (await getRepos()).visuals.put(plain)
  pane.records = pane.records.map((r) =>
    r.cacheKey === record.cacheKey ? plain : r,
  )
}
export async function reportError() {
  const repos = await getRepos()
  const reports =
    (await repos.settings.get<unknown[]>('illustrateErrorReports')) ?? []
  await repos.settings.set('illustrateErrorReports', [
    ...reports,
    {
      bookId: pane.bookId,
      sectionId: pane.section?.sectionId,
      message: pane.message,
      logs: await repos.llmLog.list({ limit: 20 }),
      createdAt: Date.now(),
    },
  ])
  pane.announcement = 'Report saved on this device.'
}
export async function goPrevious() {
  const section = active?.sections.find(
    (s) => s.sectionId === pane.previousSectionId,
  )
  if (section) await active?.bridge.scrollTo(section.cfiStart)
}
export async function clearVisuals() {
  if (!pane.bookId) return
  currentJob?.cancel()
  unbind?.()
  const repos = await getRepos()
  await repos.visuals.deleteByBook(pane.bookId)
  await repos.plans.deleteByBook(pane.bookId)
  await repos.traces.deleteByBook(pane.bookId)
  pane.records = []
  pane.previews = {}
  pane.items = []
  pane.status = 'idle'
  pane.announcement = 'Visuals cleared for this book.'
}
export async function reindex() {
  if (!lastBook) return
  const runtime = lastBook
  const repos = await getRepos()
  currentJob?.cancel()
  active?.concepts.pause()
  await repos.sectionIndex.deleteByBook(runtime.bookId)
  await repos.concepts.deleteByBook(runtime.bookId)
  const book = await repos.books.get(runtime.bookId)
  if (book)
    await repos.books.put({
      ...book,
      indexVersion: 0,
      indexStatus: 'none',
      summary: undefined,
    })
  for await (const progress of indexBookStructure(runtime.book, repos, {
    bookId: runtime.bookId,
  })) {
    pane.progress =
      progress.phase === 'done'
        ? `${progress.sectionCount} sections indexed`
        : `Re-indexing: ${progress.spineDone} of ${progress.spineTotal}`
  }
  pane.announcement =
    'Book structure re-indexed. Reopen Illustrate to approve concept indexing.'
  pane.indexingApproved = false
  await repos.settings.delete(`indexingApproved:${runtime.bookId}`)
}
export async function downloadCache() {
  if (!pane.bookId) return
  const blob = await exportCache(await getRepos(), pane.bookId)
  downloadBlob(blob, `${pane.bookId}-illustrations.json`)
}
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
export async function uploadCache(file: File) {
  const imported = await importCache(await getRepos(), await file.text())
  pane.announcement = `Imported illustrations for ${imported.bookId}. Reopen Illustrate to load the index.`
  if (pane.bookId === imported.bookId) await showCached()
}
export const enabledKinds = () =>
  VisualKind.options
    .filter((kind) => kind !== 'template' || pane.preferences.flags.templates)
    .filter((kind) => kind !== 'trace' || pane.preferences.flags.tracer)
    .filter((kind) => kind !== 'html' || pane.preferences.flags.htmlFallback)
export function parsedVisual(record: VisualRecord) {
  return IR.safeParse(record.ir)
}
