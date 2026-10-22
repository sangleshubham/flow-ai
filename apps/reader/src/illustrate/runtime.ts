import { buildLexicalIndex, indexBookStructure } from '@illus/book-index'
import {
  createConceptPass,
  estimateIndexUsage,
  resetConceptPassState,
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
import {
  bookRunTargets,
  createBookRun,
  createPipeline,
  estimateBookRun,
} from '@illus/pipeline'
import type {
  BookRun,
  BookRunProgress,
  Pipeline,
  RequestOptions,
  SectionCacheStatus,
  SectionJob,
} from '@illus/pipeline'
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
  applyBookRunProgress,
  bindJob,
  bookRunFromCache,
  bookRunStopMessage,
  createBookRunState,
  createDwell,
  DEFAULT_PREFERENCES,
  dwellDelay,
  evidenceAction,
  pane,
  migrateDwellMs,
  parseBookRuns,
  parseDwellMs,
  PREFS_VERSION,
  BOOK_RUN_VERSION,
  whenCritic,
} from './state'
import type { BookRunUiStatus, PersistedBookRun, Preferences } from './state'

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
  /** Flow's id for the open book tab; whole-book runs are saved under it. */
  flowBookId: string
  allowPlanRecheck(): void
} | null = null
/** The tab the runtime is set up (or being set up) for: `activate` for the same one only reopens the pane. */
let activeTab: { id: string; rendition: BridgeRendition } | null = null
/** The last tab `activate` was given, for `retryActivate`. */
let lastTab: BookTabLike | null = null
/** `activate` failed for `lastTab`: `retryActivate` may run it again. */
let activateFailed = false
/** The whole-book run in flight (ADR 0057); null when there is none, or once it is paused. */
let run: BookRun | null = null
/** The last run's `start()` until it settles, so a resume never overlaps a pausing run (ADR 0064: bounded). */
let settling: {
  run: BookRun
  settled: Promise<unknown>
  /** The book setup (`active`) the run belongs to: only a run of the same setup is waited for. */
  runtime: object
} | null = null
/** How long a new run waits for the previous one to settle after aborting it again. */
export const STOP_WAIT_MS = 10_000
/**
 * The run stopped (or could not resume) because the browser went offline. It stays saved as
 * `running`, and coming back online restarts it: offline sections would otherwise all count as failed.
 */
let pausedOffline = false
/** What `cancelBookRunConfirm` goes back to. */
let beforeConfirm: BookRunUiStatus = 'idle'
/** `activate` has counted the book's sections, so a confirm card can show a real estimate. */
let bookRunReady = false
/**
 * ADR 0064: "Illustrate whole book" (`confirm`) or a start pressed before the book was ready. It is
 * kept, never timed out, and done once that book (or, with a null id, the next one) is ready.
 */
let queued: { action: 'confirm' | 'start'; flowBookId: string | null } | null =
  null
/** The open book's saved run record (ADR 0064), as last written or read. */
let savedRun: PersistedBookRun | null = null
/** The last run record written while running, so progress is saved only when it changes. */
let savedSignature = ''
/** `stopBookRun` ran while this Flow book was still being prepared: its saved run must not resume. */
let stoppedWhilePreparing: string | null = null
let usageRefreshedAt = 0
const USAGE_REFRESH_MS = 10_000
/** Settings key: Flow book id → `PersistedBookRun`. */
const BOOK_RUNS_KEY = 'bookRuns'
let bookRunsWrite: Promise<void> = Promise.resolve()
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
    diagramMode: p.diagramMode === 'animated' ? 'animated' : 'static',
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
  const runs = parseBookRuns(await repos.settings.get(BOOK_RUNS_KEY))
  pane.runningBooks = pane.preferences.flags.wholeBook
    ? Object.keys(runs).filter((id) => runs[id]!.status === 'running')
    : []
  await requestPersistence(repos.settings, navigator.storage)
  await refreshUsage()
}
export async function savePreferences(next: Preferences) {
  const wholeBookWasOn = pane.preferences.flags.wholeBook
  pane.preferences = {
    ...DEFAULT_PREFERENCES,
    ...next,
    dwellMs: parseDwellMs(next.dwellMs),
    flags: resolveFlags(next.flags),
  }
  // ADR 0064: the book opened with the flag off, so its whole-book state was never prepared.
  if (!wholeBookWasOn && pane.preferences.flags.wholeBook) prepareLater()
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
  activeTab = null
  activateFailed = false
  bookRunReady = false
  savedRun = null
  // The saved status is left alone, so a `running` book resumes when it is opened again.
  run?.pause()
  run = null
  pausedOffline = false
  if (
    pane.bookRun.status !== 'paused' &&
    pane.bookRun.status !== 'paused-limit'
  )
    pane.bookRun.status = 'idle'
  pane.bookRun.inProgress = []
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
  if (
    activeTab &&
    activeTab.id === tab.book.id &&
    activeTab.rendition === tab.rendition
  ) {
    paneOpened()
    return
  }
  deactivate()
  const own = generation
  if (!tab.epub || !tab.rendition) {
    pane.status = 'idle'
    return
  }
  const book = tab.epub
  const rendition = tab.rendition
  const flowBookId = tab.book.id
  lastTab = tab
  activeTab = { id: flowBookId, rendition }
  if (stoppedWhilePreparing !== flowBookId) stoppedWhilePreparing = null
  pane.bookRun = createBookRunState()
  if (queued?.flowBookId != null && queued.flowBookId !== flowBookId)
    queued = null
  pane.bookRun.status = 'preparing'
  pane.bookRun.preparing = { label: 'Opening the book' }
  pane.bookRun.queued = queued?.action ?? null
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
      if (p.phase !== 'done')
        pane.bookRun.preparing = {
          label: 'Indexing the book',
          done: p.spineDone,
          total: p.spineTotal,
        }
    }
    pane.bookRun.preparing = { label: 'Loading the sections' }
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
    let recheckUntil = 0
    const llm = createLlmClient({
      transport: httpTransport({
        recheckPlanLimit: () => {
          const requested = recheckUntil > Date.now()
          recheckUntil = 0 // Only the next call; never grants background work an ongoing bypass.
          return requested
        },
      }),
      prompts,
      log: repos.llmLog,
      debugPrompts: () => pane.preferences.debugPrompts,
    })
    const concepts = createConceptPass({
      bookId,
      repos,
      llm,
      onProgress(p) {
        if (own !== generation) return
        pane.progress = `${p.indexed} of ${p.total} sections understood`
        if (pane.bookRun.status === 'understanding')
          pane.bookRun.indexed = { indexed: p.indexed, total: p.total }
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
    active = {
      bridge,
      pipeline,
      concepts,
      sections,
      blocks,
      book,
      bookId,
      flowBookId,
      allowPlanRecheck: () => {
        recheckUntil = Date.now() + 60_000
      },
    }
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
    // §6 phase B step 8: ask only above the threshold.
    const approved =
      !estimate.needsConfirm ||
      (await repos.books.get(bookId))?.indexStatus === 'complete' ||
      (await repos.settings.get<boolean>(`indexingApproved:${bookId}`)) === true
    // Another book may have opened during these reads: its pane state is not ours to write.
    if (own !== generation) return
    pane.estimate = {
      requests: estimate.requests,
      tokens: estimate.inputTokens,
    }
    pane.indexingApproved = approved
    disposers.push(
      bridge.onLocationChange((loc) => {
        void onLocation(loc, own)
      }),
      bridge.onSelection((sel) => {
        pane.selection = sel
      }),
    )
    bridge.refreshLocation()
    await prepareOnce(own)
  } catch (e) {
    if (own === generation) activationFailed(e)
  }
}
/** ADR 0064: never "Preparing" forever; `retryActivate` tries again (a queued request is kept). */
function activationFailed(e: unknown) {
  activeTab = null
  activateFailed = true
  pane.status = 'error'
  pane.message = (e as Error).message
  pane.bookRun.status = 'error'
  pane.bookRun.preparing = null
  pane.bookRun.message = (e as Error).message
}
/**
 * The whole-book part of `activate` (ADR 0064): counts the cache, restores the saved run, then does
 * whatever was queued. With the `wholeBook` flag off it leaves the bar idle; turning the flag on later
 * runs it then (`prepareLater`).
 */
async function prepareBookRun(own: number) {
  const runtime = active
  if (!runtime || own !== generation) return
  if (!pane.preferences.flags.wholeBook) {
    pane.bookRun.status = 'idle'
    pane.bookRun.preparing = null
    return
  }
  const { pipeline, sections, flowBookId } = runtime
  const repos = await getRepos()
  pane.bookRun.status = 'preparing'
  const targets = bookRunTargets(sections)
  pane.bookRun.preparing = {
    label: 'Checking saved illustrations',
    total: targets.length,
  }
  const [cache, runs] = await Promise.all([
    pipeline.sectionCacheStatus(targets.map((t) => t.sectionId)),
    // Read through the write chain, so a record a stop just deleted is not read back.
    bookRunsWrite
      .then(() => repos.settings.get(BOOK_RUNS_KEY))
      .then(parseBookRuns),
  ])
  if (own !== generation || active !== runtime) return
  if (!pane.preferences.flags.wholeBook) {
    pane.bookRun.status = 'idle'
    pane.bookRun.preparing = null
    return
  }
  const saved =
    stoppedWhilePreparing === flowBookId ? null : runs[flowBookId] ?? null
  stoppedWhilePreparing = null
  savedRun = saved
  savedSignature = ''
  // ADR 0064: the real done/total from the cache and the saved record, before anything starts.
  bookRunFromCache(pane.bookRun, {
    targets: targets.map((t) => t.sectionId),
    cache,
    saved,
  })
  pane.bookRun.preparing = null
  pane.bookRun.status = 'idle'
  bookRunReady = true
  const request = queued
  queued = null
  pane.bookRun.queued = null
  if (saved?.status === 'running') void startBookRun({ resume: true })
  else {
    if (saved) {
      pane.bookRun.status = saved.status
      pane.bookRun.resetAt = saved.resetAt ?? null
    }
    // Pressed while the book was loading (or from settings with the pane closed). A saved run resumes;
    // a new run always shows the confirm card first.
    if (request?.action === 'start' && saved) void resumeBookRun()
    else if (request && !saved) void confirmBookRun()
  }
}
/** The book setup whose whole-book state is being prepared, and that preparation (ADR 0065). */
let preparing: { own: number; promise: Promise<void> } | null = null
/** The book setup whose `prepareLater` failed: Retry prepares it again (ADR 0065). */
let prepareFailedAt: number | null = null
/** One `prepareBookRun` per book setup at a time: a second caller shares the one in flight. */
function prepareOnce(own: number): Promise<void> {
  if (preparing?.own === own) return preparing.promise
  const promise: Promise<void> = prepareBookRun(own).finally(() => {
    if (preparing?.promise === promise) preparing = null
  })
  preparing = { own, promise }
  return promise
}
/**
 * `wholeBook` was turned on over an open book: prepare its whole-book state now. ADR 0065: a toggle
 * while it runs shares it, and a failure is the bar's alone (its Retry), never the section pane's.
 */
function prepareLater() {
  const own = generation
  if (!active || bookRunReady) return
  prepareOnce(own).catch((e: unknown) => {
    if (own !== generation) return
    prepareFailedAt = own
    pane.bookRun.status = 'error'
    pane.bookRun.preparing = null
    pane.bookRun.message = (e as Error).message
  })
}
/** ADR 0064: sets the book up again after `activate` failed (the bar's `error` status). */
export function retryActivate() {
  // ADR 0065: only the whole-book preparation failed; the book itself is set up.
  if (prepareFailedAt === generation && active && !activateFailed) {
    prepareFailedAt = null
    pane.bookRun.message = ''
    prepareLater()
    return preparing?.promise.catch(() => {}) ?? Promise.resolve()
  }
  if (!activateFailed || !lastTab) return Promise.resolve()
  return activate(lastTab)
}
/** Pane closed: stop the reader's own work; the runtime (and a whole-book run) stays alive. */
export function paneClosed() {
  dwell.cancel()
  currentJob?.cancel()
  unbind?.()
  unbind = undefined
  currentJob = null
  if (!pane.pinned) pane.status = 'idle'
}
/** Pane reopened over a live runtime: set the open section up again (cache, then the dwell). */
export function paneOpened() {
  shownSectionId = undefined
  active?.bridge.refreshLocation()
}

/** The book's target sections and what a request would find cached for each, by current keys (ADR 0064). */
async function cacheStatus(runtime: NonNullable<typeof active>) {
  const targets = bookRunTargets(runtime.sections).map((t) => t.sectionId)
  return {
    targets,
    cache: await runtime.pipeline.sectionCacheStatus(targets),
  }
}
/** Target sections that need no model call: current-key plan and visuals cached, or nothing to draw. */
const cachedCountOf = (cache: ReadonlyMap<string, SectionCacheStatus>) =>
  [...cache.values()].filter(
    (c) => c.state === 'cached' || c.state === 'no-visual',
  ).length
/** The open book's run as saved now (ADR 0064): status plus where to resume and what failed. */
function runRecord(
  status: PersistedBookRun['status'],
  resetAt: number | null = null,
): PersistedBookRun {
  const b = pane.bookRun
  const failed = Object.keys(b.sections).filter(
    (id) => b.sections[id] === 'failed',
  )
  return {
    v: BOOK_RUN_VERSION,
    status,
    ...(resetAt !== null && { resetAt }),
    ...(b.cursor && { cursor: b.cursor }),
    ...(b.startedAt !== null && { startedAt: b.startedAt }),
    ...(failed.length > 0 && { failed }),
    ...(b.failedItems > 0 && { failedItems: b.failedItems }),
  }
}
/** Saves (or, with null, forgets) a book's run. Writes are serialized so none is lost. */
function persistBookRun(flowBookId: string, value: PersistedBookRun | null) {
  if (active?.flowBookId === flowBookId) savedRun = value
  pane.runningBooks =
    value?.status === 'running'
      ? [...new Set([...pane.runningBooks, flowBookId])]
      : pane.runningBooks.filter((id) => id !== flowBookId)
  bookRunsWrite = bookRunsWrite
    .then(async () => {
      const settings = (await getRepos()).settings
      const runs = parseBookRuns(await settings.get(BOOK_RUNS_KEY))
      delete runs[flowBookId]
      await settings.set(
        BOOK_RUNS_KEY,
        value ? { ...runs, [flowBookId]: value } : runs,
      )
    })
    .catch(() => {
      /* The run itself goes on; only resuming it after a reload is lost. */
    })
  return bookRunsWrite
}
function refreshUsageThrottled() {
  const now = Date.now()
  if (now - usageRefreshedAt < USAGE_REFRESH_MS) return
  usageRefreshedAt = now
  void refreshUsage()
}

/** Shows the confirm card with a rough request estimate (ADR 0057). */
export async function confirmBookRun() {
  const runtime = active
  if (run || !pane.preferences.flags.wholeBook) return
  if (!runtime || !bookRunReady) {
    // The book is still being set up: `activate` shows the card once it has counted the sections.
    queued = { action: 'confirm', flowBookId: activeTab?.id ?? null }
    pane.bookRun.queued = 'confirm'
    return
  }
  const own = generation
  // Recounted here: a paused run has illustrated sections since the book opened.
  const [book, { cache }] = await Promise.all([
    getRepos().then((repos) => repos.books.get(runtime.bookId)),
    cacheStatus(runtime),
  ])
  if (own !== generation || active !== runtime || run) return
  if (pane.bookRun.status !== 'confirm') beforeConfirm = pane.bookRun.status
  pane.bookRun.cachedCount = cachedCountOf(cache)
  pane.bookRun.estimate = estimateBookRun({
    uncachedSections: pane.bookRun.total - pane.bookRun.cachedCount,
    indexRequests:
      book?.indexStatus === 'complete' ? 0 : pane.estimate?.requests ?? 0,
  })
  pane.bookRun.status = 'confirm'
  pane.bookRun.message = ''
}
export function cancelBookRunConfirm() {
  if (pane.bookRun.status !== 'confirm') return
  pane.bookRun.status = beforeConfirm
  pane.bookRun.estimate = null
}
/**
 * Illustrates the whole book in the background (ADR 0057). A saved run continues from its cursor; a new
 * one starts at the section being read (ADR 0064). `resume` is an automatic restart of a saved
 * `running` run (the book opened, or the browser came back online). Pressed before the book is ready,
 * it is queued and starts once it is.
 */
export async function startBookRun({ resume = false } = {}) {
  const runtime = active
  if (!pane.preferences.flags.wholeBook) return
  if (!runtime || !bookRunReady) {
    // Queued only for a known book, so a start never carries over to whichever book opens next.
    const flowBookId = activeTab?.id ?? lastTab?.book.id
    if (!resume && flowBookId) {
      queued = { action: 'start', flowBookId }
      pane.bookRun.queued = 'start'
    }
    return
  }
  if (run) return
  if (!navigator.onLine) {
    if (resume) {
      // Still saved as `running`: it restarts when the browser is back online.
      pausedOffline = true
      pane.bookRun.status = 'paused'
    } else {
      cancelBookRunConfirm()
      pane.announcement = pane.bookRun.message =
        'You are offline. Illustrate the whole book once you are back online.'
    }
    return
  }
  pausedOffline = false
  const own = generation
  const { flowBookId } = runtime
  const saved = savedRun
  const isTarget = (id: string | null | undefined): id is string =>
    !!id && runtime.sections.some((s) => s.sectionId === id)
  // ADR 0064: a saved run continues where it stopped; a new one starts at the reader's section.
  const startAt = isTarget(saved?.cursor)
    ? saved!.cursor
    : locationId ?? pane.section?.sectionId ?? undefined
  const thisRun: BookRun = createBookRun({
    pipeline: runtime.pipeline,
    concepts: runtime.concepts,
    sections: runtime.sections,
    ...(startAt !== undefined && { startAt }),
    onProgress(p) {
      if (!current()) return
      applyBookRunProgress(pane.bookRun, p)
      saveProgress()
      refreshUsageThrottled()
    },
  })
  const current = () =>
    own === generation && run === thisRun && active === runtime
  /** Saves the cursor and failures while running, only when they change. */
  const saveProgress = () => {
    const record = runRecord('running')
    const signature = JSON.stringify(record)
    if (signature === savedSignature) return
    savedSignature = signature
    void persistBookRun(flowBookId, record)
  }
  const stopped = (message: string) => {
    pane.bookRun.status = 'paused'
    pane.bookRun.inProgress = []
    pane.bookRun.message = message
    pane.announcement = message
    void persistBookRun(flowBookId, runRecord('paused'))
  }
  run = thisRun
  // ADR 0064: waiting for the previous run is its own, bounded status.
  // Only a run of this same setup shares its concept pass; another book's run is never waited for.
  const previous = settling?.runtime === runtime ? settling : null
  pane.bookRun.status = previous ? 'stopping' : 'understanding'
  pane.bookRun.estimate = null
  pane.bookRun.resetAt = null
  pane.bookRun.indexed = null
  pane.bookRun.message = ''
  pane.bookRun.queued = null
  pane.bookRun.cursor = isTarget(startAt) ? startAt : null
  pane.bookRun.startedAt = saved?.startedAt ?? Date.now()
  savedSignature = ''
  saveProgress()
  // The confirm card included the indexing estimate, so starting the run approves the indexing.
  if (!pane.indexingApproved) {
    pane.indexingApproved = true
    void (await getRepos()).settings.set(
      `indexingApproved:${runtime.bookId}`,
      true,
    )
  }
  if (!current()) return
  // A paused run's concept pass must stop before this run asks it to start again. The wait is bounded:
  // abort it again, then go on after `STOP_WAIT_MS` (a pass still stopping then pauses this run).
  if (previous) {
    previous.run.pause()
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      previous.settled,
      new Promise((r) => (timer = setTimeout(r, STOP_WAIT_MS))),
    ])
    clearTimeout(timer)
    if (!current()) return
    pane.bookRun.status = 'understanding'
  }
  const started = thisRun.start()
  const entry = { run: thisRun, settled: started.catch(() => {}), runtime }
  settling = entry
  void entry.settled.then(() => {
    if (settling === entry) settling = null
  })
  let result: BookRunProgress
  try {
    result = await started
  } catch (e) {
    if (current()) {
      run = null
      stopped(`The whole-book run stopped: ${(e as Error).message}`)
    }
    return
  }
  if (!current()) return
  try {
    applyBookRunProgress(pane.bookRun, result)
    if (result.status === 'done') {
      void persistBookRun(flowBookId, null)
      pane.bookRun.cursor = null
      pane.bookRun.startedAt = null
      const { cache } = await cacheStatus(runtime)
      if (current()) pane.bookRun.cachedCount = cachedCountOf(cache)
    } else if (result.status === 'paused') {
      // `pauseBookRun` and `deactivate` drop the run first, so the run paused itself.
      stopped(bookRunStopMessage(result.stoppedBy))
      if (result.stoppedBy) void refreshUsage()
    } else if (result.status === 'paused-limit') {
      await refreshUsage()
      if (!current()) return
      const pausedUntil = pane.usage?.pausedUntil
      const resetAt =
        pausedUntil && pausedUntil > Date.now()
          ? pausedUntil
          : result.retryAfterMs !== undefined
          ? Date.now() + result.retryAfterMs
          : null
      pane.bookRun.status = 'paused-limit'
      pane.bookRun.resetAt = resetAt
      // No timer and no auto-resume: after a plan limit only the user resumes (ADR 0057).
      void persistBookRun(flowBookId, runRecord('paused-limit', resetAt))
    }
  } finally {
    if (run === thisRun) run = null
  }
}
export function pauseBookRun() {
  const runtime = active
  const paused = run
  pausedOffline = false
  if (!runtime || !paused) {
    // A run waiting to come back online: the user's pause makes it stay paused.
    if (runtime && pane.bookRun.status === 'paused')
      void persistBookRun(runtime.flowBookId, runRecord('paused'))
    return
  }
  run = null
  pane.bookRun.status = 'paused'
  pane.bookRun.inProgress = []
  for (const id of Object.keys(pane.bookRun.sections))
    if (pane.bookRun.sections[id] === 'running')
      pane.bookRun.sections[id] = 'pending'
  void persistBookRun(runtime.flowBookId, runRecord('paused'))
  paused.pause()
}
/**
 * ADR 0064: ends the run and forgets its saved record (unlike pause, there is nothing to resume).
 * Every cached plan and visual stays; the bar shows the cached count again.
 */
export async function stopBookRun() {
  const runtime = active
  pausedOffline = false
  queued = null
  pane.bookRun.queued = null
  if (!runtime || !bookRunReady) {
    // Still preparing: forget the saved run so it does not resume once the book is ready. The bar keeps
    // its preparing status and shows the counts when ready.
    const flowBookId = runtime?.flowBookId ?? activeTab?.id
    if (!flowBookId) return
    stoppedWhilePreparing = flowBookId
    await persistBookRun(flowBookId, null)
    return
  }
  const stopped = run
  run = null
  stopped?.pause()
  const write = persistBookRun(runtime.flowBookId, null)
  Object.assign(pane.bookRun, {
    status: 'idle',
    inProgress: [],
    message: '',
    estimate: null,
    resetAt: null,
    indexed: null,
    cursor: null,
    startedAt: null,
    session: null,
  })
  const own = generation
  try {
    const { targets, cache } = await cacheStatus(runtime)
    if (own === generation && active === runtime && !run)
      bookRunFromCache(pane.bookRun, { targets, cache, saved: null })
  } finally {
    await write
  }
}
/** Offline, every section would fail: stop the run but keep it saved as `running` (see `pausedOffline`). */
function pauseBookRunOffline() {
  const paused = run
  if (!paused) return
  run = null
  pausedOffline = true
  pane.bookRun.status = 'paused'
  pane.bookRun.inProgress = []
  paused.pause()
}
/** User-initiated resume may recheck access before the local pause expires. */
export function resumeBookRun() {
  if (pane.bookRun.status === 'paused-limit') active?.allowPlanRecheck()
  return startBookRun()
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
  // The runtime may be alive with the pane closed (a whole-book run): never start a dwell then;
  // `paneOpened` sets the section up again.
  if (!pane.open) {
    pane.status = 'idle'
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
/** Explicit Retry can check restored access; dwell, indexing and navigation keep obeying the pause. */
export function retryVisual() {
  if (!active || !pane.section || !pane.open || !navigator.onLine) return
  if (
    pane.status === 'plan-limit' ||
    (pane.usage?.pausedUntil ?? 0) > Date.now()
  )
    active.allowPlanRecheck()
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
/**
 * Shows the section's current-key plan and the visuals made from it (ADR 0064: records under older
 * keys are not shown as current). True when the section needs no model call, so the dwell is skipped.
 * ADR 0065: what is not current falls back to the pipeline's stale visuals (marked `stale`, so the
 * pane says they are from an earlier version), whose IR still parses. They never make it true.
 */
export async function showCached(): Promise<boolean> {
  if (!active || !pane.section) return false
  const section = pane.section
  const runtime = active
  let cached: Awaited<ReturnType<Pipeline['cachedSection']>>
  try {
    cached = await runtime.pipeline.cachedSection(section.sectionId, {
      stale: true,
    })
  } catch {
    return false
  }
  if (active !== runtime || pane.section?.sectionId !== section.sectionId)
    return false
  const latest = new Map<string, VisualRecord>()
  for (const r of [...cached.records].sort((a, b) => a.createdAt - b.createdAt))
    latest.set(r.planItemId, r)
  for (const r of cached.stale?.records ?? [])
    if (!latest.has(r.planItemId) && displayable(r)) latest.set(r.planItemId, r)
  pane.records = [...latest.values()]
  // With no current plan, only the stale plan's items that have a visual to show.
  pane.items =
    cached.status.plan?.plan.items ??
    cached.stale?.plan.plan.items.filter((i) => latest.has(i.planItemId)) ??
    []
  pane.selectedItem =
    pane.items[0]?.planItemId ?? pane.records[0]?.planItemId ?? ''
  return cached.status.state === 'cached' || cached.status.state === 'no-visual'
}
/** ADR 0065: a stale visual is shown only when its IR still parses (traces point at a stored trace). */
const displayable = (r: VisualRecord) =>
  r.kind === 'trace' || parsedVisual(r).success
export function networkChanged() {
  if (!navigator.onLine) {
    currentJob?.cancel()
    pauseBookRunOffline()
    void showCached().then(() => {
      pane.status = 'offline'
    })
  } else {
    if (pausedOffline) void startBookRun({ resume: true })
    if (pane.status === 'offline') requestVisual()
  }
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
  // ADR 0065: `stale` marks a fallback in memory only; the stored record never carries it.
  await (await getRepos()).visuals.put({ ...plain, stale: false })
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
  // ADR 0061: remembered concept-pass gaps refer to the deleted indexes.
  await resetConceptPassState(repos, runtime.bookId)
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
/** ADR 0065: never throws, so an old record whose IR no longer fits the schema cannot break the pane. */
export function parsedVisual(
  record: VisualRecord,
): ReturnType<typeof IR.safeParse> {
  try {
    return IR.safeParse(record.ir)
  } catch {
    // Malformed old data made the parser throw: report it as a failed parse.
    return IR.safeParse(null)
  }
}
