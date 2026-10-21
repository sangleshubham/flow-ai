import { makeBookId } from '@illus/core'
import { make } from '@illus/core/testing'
import { httpTransport } from '@illus/llm'
import { createPipeline } from '@illus/pipeline'
import type {
  BookRunDeps,
  BookRunProgress,
  SectionCacheState,
  SectionCacheStatus,
} from '@illus/pipeline'
import type { BridgeRendition } from '@illus/reader-bridge'
import type { EvidenceEvent } from '@illus/render'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Book } from '@flow/epubjs'

import { bookRunText } from './PaneContent'
import {
  activate,
  cancelBookRunConfirm,
  confirmBookRun,
  deactivate,
  getRepos,
  highlightEvidence,
  loadPreferences,
  networkChanged,
  paneClosed,
  paneOpened,
  pauseBookRun,
  reindex,
  resumeBookRun,
  requestVisual,
  retryActivate,
  retryVisual,
  savePreferences,
  startBookRun,
  STOP_WAIT_MS,
  stopBookRun,
} from './runtime'
import { createPaneState, pane } from './state'

/** A whole-book run whose `start()` resolves only when the test settles it (as a real one does after `pause()`). */
interface FakeBookRun {
  deps: BookRunDeps
  start: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  settle(status: BookRunProgress['status'], o?: Partial<BookRunProgress>): void
}
const { bookRuns, cacheStates, cacheHold } = vi.hoisted(() => ({
  bookRuns: { created: [] as FakeBookRun[] },
  /** While `promise` is set, the cache check waits for it (the book stays `preparing`). */
  cacheHold: { promise: null as Promise<void> | null },
  /** What the pipeline's cache-status helpers report per section id (default `missing`). */
  cacheStates: {} as Record<string, SectionCacheState>,
}))
vi.mock('@illus/llm', async (importOriginal) => {
  const real = await importOriginal<typeof import('@illus/llm')>()
  return { ...real, httpTransport: vi.fn(real.httpTransport) }
})
vi.mock('@illus/pipeline', async (importOriginal) => {
  const real = await importOriginal<typeof import('@illus/pipeline')>()
  return {
    ...real,
    // The real pipeline, with its cache-status helpers reading `cacheStates` (they need real prompts).
    createPipeline: vi.fn((deps: Parameters<typeof real.createPipeline>[0]) => {
      const pipeline = real.createPipeline(deps)
      const statusOf = (id: string): SectionCacheStatus => ({
        state: cacheStates[id] ?? 'missing',
        sectionId: id,
        visuals: [],
      })
      return Object.assign(pipeline, {
        sectionCacheStatus: vi.fn(async (ids: readonly string[]) => {
          await cacheHold.promise
          return new Map(ids.map((id) => [id, statusOf(id)]))
        }),
        cachedSection: vi.fn(async (id: string) => ({
          status: statusOf(id),
          records: [],
        })),
      })
    }),
    createBookRun: vi.fn((deps: BookRunDeps) => {
      const progress = (
        status: BookRunProgress['status'],
        o: Partial<BookRunProgress> = {},
      ): BookRunProgress => ({
        status,
        total: 1,
        finished: 0,
        noVisual: 0,
        failedItems: 0,
        inProgress: [],
        sections: {},
        sessionDone: 0,
        ...o,
      })
      let resolve!: (p: BookRunProgress) => void
      const finished = new Promise<BookRunProgress>((yes) => (resolve = yes))
      const fake: FakeBookRun = {
        deps,
        start: vi.fn(() => finished),
        pause: vi.fn(),
        settle: (status, o) => resolve(progress(status, o)),
      }
      bookRuns.created.push(fake)
      return {
        start: fake.start,
        pause: fake.pause,
        get progress() {
          return progress('paused')
        },
      }
    }),
  }
})

const { bridge } = vi.hoisted(() => ({
  bridge: {
    quoteToCfi: vi.fn(),
    scrollTo: vi.fn(),
    highlight: vi.fn(),
    clearHighlights: vi.fn(),
    onLocationChange: vi.fn(() => () => {}),
    onSelection: vi.fn(() => () => {}),
    refreshLocation: vi.fn(),
    dispose: vi.fn(),
  },
}))
vi.mock('@illus/book-index', () => ({
  indexBookStructure: async function* () {},
  buildLexicalIndex: vi.fn(),
}))
vi.mock('@illus/reader-bridge', () => ({ createReaderBridge: () => bridge }))
vi.mock('@illus/render', () => ({
  readFlowTheme: vi.fn(),
  reviewHook: vi.fn(),
  templateRegistry: {},
}))
vi.mock('@illus/store', async () => {
  const { createMemoryRepos } = await import('@illus/core/testing')
  const repos = createMemoryRepos()
  return {
    createDexieRepos: () => repos,
    openIllusDb: vi.fn(),
    requestPersistence: vi.fn(),
    exportCache: vi.fn(),
    importCache: vi.fn(),
  }
})
vi.mock('@illus/tracer', () => ({
  createBrowserTraceWorker: vi.fn(),
  createTraceRunner: vi.fn(),
  TRACER_VERSION: 'test',
}))
const { files } = vi.hoisted(() => ({
  files: {
    get: vi.fn(
      async (): Promise<unknown> => ({
        file: { arrayBuffer: async () => new ArrayBuffer(0) },
      }),
    ),
  },
}))
vi.mock('../db', () => ({ db: { files } }))
vi.mock('./prompt-files', () => ({ PROMPT_FILES: {} }))

const block = make.block()
const event: EvidenceEvent = {
  irId: 'step',
  target: 'node:a',
  label: 'Step',
  evidence: make.evidence(),
}

beforeEach(async () => {
  Object.assign(pane, createPaneState())
  vi.stubGlobal('navigator', { storage: {} })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false })),
  )
  bridge.quoteToCfi.mockResolvedValue('quote-cfi')
  const repos = await getRepos()
  await repos.settings.delete('illustratePreferences')
  const bookId = await makeBookId(new Uint8Array())
  await repos.sections.put(make.sectionNode({ bookId }))
  await repos.blocks.put(block)
})
afterEach(() => {
  deactivate()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('manual plan access checks', () => {
  it('arms one recheck on Retry, while ordinary requests never bypass a pause', async () => {
    vi.stubGlobal('navigator', { storage: {}, onLine: true })
    pane.open = true
    await activate({
      book: { id: 'test' },
      epub: {} as Book,
      rendition: {} as BridgeRendition,
    })
    const bookId = await makeBookId(new Uint8Array())
    pane.section = (await (await getRepos()).sections.listByBook(bookId))[0]!
    const pipeline = vi.mocked(createPipeline).mock.results.at(-1)!.value
    vi.spyOn(pipeline, 'requestSection').mockReturnValue({
      on: () => () => {},
      cancel: vi.fn(),
    })
    const consume = vi.mocked(httpTransport).mock.calls.at(-1)![0]!
      .recheckPlanLimit!
    pane.status = 'plan-limit'
    requestVisual()
    expect(consume()).toBe(false)
    pane.status = 'plan-limit'
    retryVisual()
    expect(consume()).toBe(true)
    expect(consume()).toBe(false)
    expect(pipeline.requestSection).toHaveBeenCalledTimes(2)
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    pane.status = 'plan-limit'
    retryVisual()
    now += 60_001
    expect(consume()).toBe(false) // An unused check cannot leak to much later background work.
  })
})

describe('remembered diagram view', () => {
  it.each([
    undefined,
    {},
    { speed: 1.5 },
    { diagramMode: 'invalid' },
    { diagramMode: null },
  ])(
    'migrates missing or invalid diagramMode to static in %j',
    async (saved) => {
      if (saved)
        await (await getRepos()).settings.set('illustratePreferences', saved)
      pane.preferences.diagramMode = 'animated'
      await loadPreferences()
      expect(pane.preferences.diagramMode).toBe('static')
    },
  )

  it.each(['static', 'animated'] as const)(
    'persists and reloads %s mode',
    async (diagramMode) => {
      await savePreferences({ ...pane.preferences, diagramMode })
      expect(
        await (await getRepos()).settings.get('illustratePreferences'),
      ).toMatchObject({ diagramMode })
      pane.preferences.diagramMode =
        diagramMode === 'static' ? 'animated' : 'static'
      await loadPreferences()
      expect(pane.preferences.diagramMode).toBe(diagramMode)
    },
  )
})

describe('remembered step highlights (ADR 0052)', () => {
  it.each([undefined, {}, { autoHighlight: false }])(
    'defaults missing highlightSteps to on in %j',
    async (saved) => {
      if (saved)
        await (await getRepos()).settings.set('illustratePreferences', saved)
      await loadPreferences()
      expect(pane.preferences.highlightSteps).toBe(true)
    },
  )

  it('remembers an explicit opt-out across preference reloads', async () => {
    await savePreferences({ ...pane.preferences, highlightSteps: false })
    pane.preferences.highlightSteps = true
    await loadPreferences()
    expect(pane.preferences.highlightSteps).toBe(false)
    await savePreferences({ ...pane.preferences, highlightSteps: true })
    pane.preferences.highlightSteps = false
    await loadPreferences()
    expect(pane.preferences.highlightSteps).toBe(true)
  })
})

describe('evidence navigation', () => {
  beforeEach(async () => {
    await activate({
      book: { id: 'test' },
      epub: {} as Book,
      rendition: {} as BridgeRendition,
    })
    expect(pane.status).not.toBe('error')
  })

  it('highlights a step with hover highlighting off, and never moves the page during playback', async () => {
    pane.preferences.autoHighlight = false
    await highlightEvidence(event, false, 'step')
    expect(bridge.highlight).toHaveBeenCalledWith('quote-cfi', 'step')
    expect(bridge.scrollTo).not.toHaveBeenCalled()
    await highlightEvidence(null, false, 'step')
    expect(bridge.clearHighlights).toHaveBeenCalledTimes(2)
    bridge.quoteToCfi.mockClear()
    await highlightEvidence(event)
    expect(bridge.quoteToCfi).not.toHaveBeenCalled()
  })

  it('turns to an already-resolved quote on explicit click', async () => {
    await highlightEvidence(event, true, 'step')
    expect(bridge.scrollTo).toHaveBeenCalledExactlyOnceWith('quote-cfi')
    expect(bridge.highlight).toHaveBeenCalledWith('quote-cfi', 'step')
  })

  it('does not restore an asynchronous step highlight after the option is cleared', async () => {
    pane.preferences.autoHighlight = false
    let resolve!: (cfi: string) => void
    bridge.quoteToCfi.mockReturnValueOnce(
      new Promise<string>((yes) => {
        resolve = yes
      }),
    )
    const pending = highlightEvidence(event, false, 'step')
    await highlightEvidence(null, false, 'step')
    resolve('stale-step-cfi')
    await pending
    expect(bridge.highlight).not.toHaveBeenCalled()
    expect(bridge.scrollTo).not.toHaveBeenCalled()
  })

  it('shows the block and resolves the quote again when the chapter is not loaded', async () => {
    bridge.quoteToCfi
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('loaded-quote-cfi')
    await highlightEvidence(event, true)
    expect(bridge.scrollTo).toHaveBeenCalledExactlyOnceWith(block.cfiRange)
    expect(bridge.quoteToCfi).toHaveBeenCalledTimes(2)
    expect(bridge.highlight).toHaveBeenCalledWith(
      'loaded-quote-cfi',
      'evidence',
    )
  })

  it('does not turn the page or highlight after a pending click is superseded', async () => {
    let resolve!: (cfi: string) => void
    bridge.quoteToCfi.mockReturnValueOnce(
      new Promise<string>((yes) => {
        resolve = yes
      }),
    )
    const pending = highlightEvidence(event, true)
    await highlightEvidence({ ...event, label: 'Newer passage' }, true)
    resolve('stale-cfi')
    await pending
    expect(bridge.scrollTo).toHaveBeenCalledExactlyOnceWith('quote-cfi')
    expect(bridge.highlight).toHaveBeenCalledExactlyOnceWith(
      'quote-cfi',
      'evidence',
    )
  })

  it('ignores a quote that resolves after the book is closed', async () => {
    let resolve!: (cfi: string) => void
    bridge.quoteToCfi.mockReturnValueOnce(
      new Promise<string>((yes) => {
        resolve = yes
      }),
    )
    const pending = highlightEvidence(event, true)
    deactivate()
    resolve('closed-book-cfi')
    await pending
    expect(bridge.scrollTo).not.toHaveBeenCalled()
    expect(bridge.highlight).not.toHaveBeenCalled()
  })
})

describe('location changes', () => {
  let section: Awaited<
    ReturnType<Awaited<ReturnType<typeof getRepos>>['sections']['listByBook']>
  >[number]
  const publish = async (sectionId: string | null) => {
    const cb = (
      bridge.onLocationChange.mock.calls as unknown as [(l: unknown) => void][]
    )[0]![0]
    cb({ bookId: section.bookId, cfi: 'epubcfi(/6/2!/4/2)', sectionId })
    await new Promise((r) => setTimeout(r, 0))
  }
  beforeEach(async () => {
    const bookId = await makeBookId(new Uint8Array())
    section = (await (await getRepos()).sections.listByBook(bookId))[0]!
    await activate({
      book: { id: 'test' },
      epub: {} as Book,
      rendition: {} as BridgeRendition,
    })
    await publish(section.sectionId)
    expect(pane.section?.sectionId).toBe(section.sectionId)
  })

  it('leaves the pane alone when an evidence click re-publishes the open section', async () => {
    pane.status = 'ready'
    pane.selectedItem = 'second'
    await publish(section.sectionId)
    expect(pane.status).toBe('ready')
    expect(pane.selectedItem).toBe('second')
  })

  it('still follows the reader after unpinning on another section', async () => {
    pane.pinned = true
    pane.status = 'ready'
    await publish('elsewhere')
    expect(pane.status).toBe('ready')
    pane.pinned = false
    await publish('elsewhere') // unpin() refreshes the bridge, which publishes the reader's section
    expect(pane.section).toBeNull()
    expect(pane.status).toBe('idle')
  })

  it('sets the section up again after the pane is closed and reopened', async () => {
    deactivate()
    pane.status = 'idle'
    await activate({
      book: { id: 'test' },
      epub: {} as Book,
      rendition: {} as BridgeRendition,
    })
    const calls = bridge.onLocationChange.mock.calls as unknown as [
      (l: unknown) => void,
    ][]
    calls.at(-1)![0]({
      bookId: section.bookId,
      cfi: 'epubcfi(/6/2!/4/2)',
      sectionId: section.sectionId,
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(pane.status).not.toBe('idle')
  })
})

describe('whole-book run (ADR 0057)', () => {
  const FLOW_ID = 'flow-book'
  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  }
  const tab = () => ({
    book: { id: FLOW_ID },
    epub: {} as Book,
    rendition: {} as BridgeRendition,
  })
  const settings = async () => (await getRepos()).settings
  const saved = async () => (await settings()).get('bookRuns')
  let sectionId: string
  let bookId: string
  const publish = async (id: string | null) => {
    const calls = bridge.onLocationChange.mock.calls as unknown as [
      (l: unknown) => void,
    ][]
    calls.at(-1)![0]({ bookId, cfi: 'epubcfi(/6/2!/4/2)', sectionId: id })
    await flush()
  }

  beforeEach(async () => {
    vi.stubGlobal('navigator', { storage: {}, onLine: true })
    bookId = await makeBookId(new Uint8Array())
    sectionId = (await (await getRepos()).sections.listByBook(bookId))[0]!
      .sectionId
    await (await settings()).delete('bookRuns')
    await (await settings()).delete(`indexingApproved:${bookId}`)
    pane.open = true
  })
  afterEach(async () => {
    deactivate()
    for (const r of bookRuns.created) r.settle('paused')
    bookRuns.created.length = 0
    await flush()
  })

  it('starts from the section being read, saves it as running and approves indexing', async () => {
    pane.open = false
    await activate(tab())
    await publish(sectionId)
    expect(pane.bookRun.total).toBe(1)
    pane.indexingApproved = false
    const started = startBookRun()
    expect(pane.bookRun.status).toBe('understanding')
    expect(pane.runningBooks).toEqual([FLOW_ID])
    await flush()
    expect(bookRuns.created).toHaveLength(1)
    const [run] = bookRuns.created
    expect(run!.deps.startAt).toBe(sectionId)
    expect(run!.start).toHaveBeenCalledOnce()
    expect(pane.indexingApproved).toBe(true)
    expect(await (await settings()).get(`indexingApproved:${bookId}`)).toBe(
      true,
    )
    expect(await saved()).toEqual({
      [FLOW_ID]: {
        v: 2,
        status: 'running',
        cursor: sectionId,
        startedAt: expect.any(Number),
      },
    })
    // A second start while running does nothing.
    await startBookRun()
    expect(bookRuns.created).toHaveLength(1)

    run!.settle('done', { finished: 1 })
    await started
    await flush()
    expect(pane.bookRun.status).toBe('done')
    expect(pane.bookRun.finished).toBe(1)
    expect(pane.runningBooks).toEqual([])
    expect(await saved()).toEqual({})
  })

  it('pauses on request, ignores the paused run, and resumes only after it settles', async () => {
    await activate(tab())
    void startBookRun()
    await flush()
    const [first] = bookRuns.created
    pauseBookRun()
    expect(first!.pause).toHaveBeenCalledOnce()
    expect(pane.bookRun.status).toBe('paused')
    expect(pane.runningBooks).toEqual([])
    await flush()
    expect(await saved()).toMatchObject({
      [FLOW_ID]: { v: 2, status: 'paused' },
    })

    const resumed = resumeBookRun()
    await flush()
    const second = bookRuns.created[1]!
    expect(second.start).not.toHaveBeenCalled()
    // ADR 0064: waiting for the paused run has its own status, and aborts it again.
    expect(pane.bookRun.status).toBe('stopping')
    expect(first!.pause).toHaveBeenCalledTimes(2)
    first!.settle('paused', { finished: 7 })
    await flush()
    expect(second.start).toHaveBeenCalledOnce()
    expect(pane.bookRun.status).toBe('understanding')
    expect(pane.bookRun.finished).toBe(0)
    expect(await saved()).toMatchObject({
      [FLOW_ID]: { v: 2, status: 'running' },
    })
    second.settle('done')
    await resumed
    expect(pane.bookRun.status).toBe('done')
  })

  it('stays paused after the plan limit until explicit Resume, including before the local deadline', async () => {
    await activate(tab())
    const started = startBookRun()
    await flush()
    const before = Date.now()
    bookRuns.created[0]!.settle('paused-limit', { retryAfterMs: 60_000 })
    await started
    await flush()
    expect(pane.bookRun.status).toBe('paused-limit')
    const resetAt = pane.bookRun.resetAt!
    expect(resetAt).toBeGreaterThanOrEqual(before + 60_000)
    expect(pane.runningBooks).toEqual([])
    expect(await saved()).toMatchObject({
      [FLOW_ID]: { v: 2, status: 'paused-limit', resetAt },
    })

    expect(bookRuns.created).toHaveLength(1) // Never auto-resume.
    const consume = vi.mocked(httpTransport).mock.calls.at(-1)![0]!
      .recheckPlanLimit!
    expect(consume()).toBe(false)
    void resumeBookRun()
    await flush()
    expect(bookRuns.created).toHaveLength(2)
    expect(consume()).toBe(true)
    expect(consume()).toBe(false)
  })

  it('keeps a running book saved when the book closes and resumes it when it opens', async () => {
    await activate(tab())
    void startBookRun()
    await flush()
    deactivate()
    expect(bookRuns.created[0]!.pause).toHaveBeenCalledOnce()
    expect(pane.bookRun.status).toBe('idle')
    await flush()
    expect(await saved()).toMatchObject({
      [FLOW_ID]: { v: 2, status: 'running' },
    })
    expect(pane.runningBooks).toEqual([FLOW_ID])

    await activate(tab())
    await flush()
    expect(bookRuns.created).toHaveLength(2)
    // ADR 0064: the closed book's run belongs to another setup, so it is never waited for.
    expect(bookRuns.created[1]!.start).toHaveBeenCalledOnce()
    expect(pane.bookRun.status).toBe('understanding')
  })

  it('stops while offline, stays saved as running, and restarts back online', async () => {
    await activate(tab())
    void startBookRun()
    await flush()
    const nav = navigator as { onLine: boolean }
    nav.onLine = false
    networkChanged()
    expect(bookRuns.created[0]!.pause).toHaveBeenCalledOnce()
    expect(pane.bookRun.status).toBe('paused')
    await flush()
    expect(await saved()).toMatchObject({
      [FLOW_ID]: { v: 2, status: 'running' },
    })
    expect(pane.runningBooks).toEqual([FLOW_ID])
    bookRuns.created[0]!.settle('paused')
    nav.onLine = true
    networkChanged()
    await flush()
    expect(bookRuns.created).toHaveLength(2)
    expect(bookRuns.created[1]!.start).toHaveBeenCalledOnce()
    expect(pane.bookRun.status).toBe('understanding')
  })

  it('does nothing for the whole book while the flag is off', async () => {
    await (
      await settings()
    ).set('bookRuns', { [FLOW_ID]: { status: 'running' } })
    pane.preferences.flags = { ...pane.preferences.flags, wholeBook: false }
    await activate(tab())
    await flush()
    await startBookRun()
    await confirmBookRun()
    expect(bookRuns.created).toHaveLength(0)
    expect(pane.bookRun.status).toBe('idle')
  })

  it('restores a plan-limit pause without starting anything', async () => {
    await (
      await settings()
    ).set('bookRuns', { [FLOW_ID]: { status: 'paused-limit', resetAt: 99 } })
    await activate(tab())
    await flush()
    expect(bookRuns.created).toHaveLength(0)
    expect(pane.bookRun.status).toBe('paused-limit')
    expect(pane.bookRun.resetAt).toBe(99)
  })

  it('loads the running books from settings and ignores malformed entries', async () => {
    await (
      await settings()
    ).set('bookRuns', {
      a: { status: 'running' },
      b: { status: 'paused' },
      c: { status: 'running', resetAt: 'never' },
      d: 'running',
    })
    await loadPreferences()
    expect(pane.runningBooks).toEqual(['a'])
  })

  it('confirms with an estimate and cancels back', async () => {
    await activate(tab())
    await confirmBookRun()
    expect(pane.bookRun.status).toBe('confirm')
    expect(pane.bookRun.estimate).toBe(5 + (pane.estimate?.requests ?? 0))
    cancelBookRunConfirm()
    expect(pane.bookRun.status).toBe('idle')
    expect(pane.bookRun.estimate).toBeNull()
  })

  it('"Illustrate whole book" pressed before the book is ready shows the card once it is', async () => {
    await confirmBookRun()
    expect(pane.bookRun.status).toBe('idle')
    await activate(tab())
    await flush()
    expect(pane.bookRun.status).toBe('confirm')
    expect(pane.bookRun.estimate).toBe(5 + (pane.estimate?.requests ?? 0))
    // Consumed: opening the book again shows no card.
    cancelBookRunConfirm()
    deactivate()
    await activate(tab())
    await flush()
    expect(pane.bookRun.status).toBe('idle')
  })

  it('a run that paused itself says why and stays paused', async () => {
    await activate(tab())
    const started = startBookRun()
    await flush()
    bookRuns.created[0]!.settle('paused', {
      stoppedBy: { code: 'signin-required', message: 'Sign in' },
    })
    await started
    await flush()
    expect(pane.bookRun.status).toBe('paused')
    expect(pane.bookRun.message).toBe(
      'ChatGPT needs you to sign in again. Sign in, then resume.',
    )
    expect(pane.runningBooks).toEqual([])
    expect(await saved()).toMatchObject({
      [FLOW_ID]: { v: 2, status: 'paused' },
    })
  })

  it('never starts a dwell with the pane closed, and sets the section up on reopening', async () => {
    const t = tab()
    await activate(t)
    paneClosed()
    pane.open = false
    await publish(sectionId)
    expect(pane.status).toBe('idle')
    // Opening the pane over the live runtime does not rebuild it.
    pane.open = true
    await activate(t)
    expect(bridge.dispose).not.toHaveBeenCalled()
    expect(bridge.refreshLocation).toHaveBeenCalledTimes(2)
    paneOpened()
    await publish(sectionId)
    expect(pane.status).toBe('waiting')
  })
})

describe('resumable whole-book runs (ADR 0064)', () => {
  const FLOW_ID = 'flow-book'
  const IDS = ['s2', 's3', 's4']
  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  }
  const tab = () => ({
    book: { id: FLOW_ID },
    epub: {} as Book,
    rendition: {} as BridgeRendition,
  })
  const settings = async () => (await getRepos()).settings
  const saved = async () =>
    ((await (await settings()).get('bookRuns')) ?? {}) as Record<
      string,
      Record<string, unknown>
    >
  const save = async (record: unknown) =>
    (await settings()).set('bookRuns', { [FLOW_ID]: record })
  let bookId: string
  /** The book's first target (`make.sectionNode`, ordinal 1), then s2, s3, s4. */
  let first: string
  const publish = async (id: string | null) => {
    const calls = bridge.onLocationChange.mock.calls as unknown as [
      (l: unknown) => void,
    ][]
    calls.at(-1)![0]({ bookId, cfi: 'epubcfi(/6/2!/4/2)', sectionId: id })
    await flush()
  }

  beforeEach(async () => {
    vi.stubGlobal('navigator', { storage: {}, onLine: true })
    bookId = await makeBookId(new Uint8Array())
    const repos = await getRepos()
    first = (await repos.sections.listByBook(bookId))[0]!.sectionId
    await repos.sections.bulkPut(
      IDS.map((sectionId, i) =>
        make.sectionNode({ bookId, sectionId, ordinal: i + 2 }),
      ),
    )
    await (await settings()).delete('bookRuns')
    pane.open = true
  })
  afterEach(async () => {
    deactivate()
    for (const r of bookRuns.created) r.settle('paused')
    bookRuns.created.length = 0
    for (const id of Object.keys(cacheStates)) delete cacheStates[id]
    cacheHold.promise = null
    pane.preferences.flags = { ...pane.preferences.flags, wholeBook: true }
    const repos = await getRepos()
    for (const id of IDS) await repos.sections.delete(id)
    vi.useRealTimers()
    await flush()
  })

  it('after a reload the bar shows the real count, map and cursor from the cache and the saved record', async () => {
    cacheStates[first] = 'cached'
    cacheStates.s2 = 'no-visual'
    cacheStates.s3 = 'partial'
    await save({
      v: 2,
      status: 'paused',
      cursor: 's3',
      startedAt: 5,
      failed: ['s4'],
      failedItems: 2,
    })
    await activate(tab())
    await flush()
    expect(bookRuns.created).toHaveLength(0)
    expect(pane.bookRun).toMatchObject({
      status: 'paused',
      total: 4,
      finished: 3,
      cachedCount: 2,
      noVisual: 1,
      failedItems: 2,
      cursor: 's3',
      startedAt: 5,
      sections: {
        [first]: 'cached',
        s2: 'no-visual',
        s3: 'pending',
        s4: 'failed',
      },
      preparing: null,
    })
    expect(bookRunText(pane.bookRun)).toBe('Paused at 3 / 4')
  })

  it('reads a version 1 record and shows cached sections, never 0', async () => {
    cacheStates[first] = 'cached'
    cacheStates.s3 = 'cached'
    await save({ status: 'paused' })
    await activate(tab())
    await flush()
    expect(pane.bookRun).toMatchObject({
      status: 'paused',
      finished: 2,
      cursor: null,
    })
  })

  it("resumes from the saved cursor, not the reader's section; a new run starts at the reader", async () => {
    await save({ v: 2, status: 'paused', cursor: 's3', startedAt: 5 })
    await activate(tab())
    await publish(first)
    void resumeBookRun()
    await flush()
    expect(bookRuns.created[0]!.deps.startAt).toBe('s3')
    expect(pane.bookRun.startedAt).toBe(5)
    expect((await saved())[FLOW_ID]).toMatchObject({
      status: 'running',
      cursor: 's3',
      startedAt: 5,
    })
    // The run's progress moves the saved cursor.
    bookRuns.created[0]!.deps.onProgress!({
      status: 'illustrating',
      total: 4,
      finished: 2,
      noVisual: 0,
      failedItems: 1,
      inProgress: ['s4'],
      sections: {
        [first]: 'pending',
        s2: 'pending',
        s3: 'failed',
        s4: 'running',
      },
      cursor: 's4',
      startedAt: 10,
      sessionDone: 1,
    })
    await flush()
    expect((await saved())[FLOW_ID]).toMatchObject({
      status: 'running',
      cursor: 's4',
      failed: ['s3'],
      failedItems: 1,
    })
    expect(pane.bookRun.session).toEqual({
      startedAt: 10,
      done: 1,
      avgSectionMs: null,
    })
    bookRuns.created[0]!.settle('done', { finished: 4, total: 4 })
    await flush()
    expect(await saved()).toEqual({})

    // No record any more: a new run starts where the reader is.
    await publish('s2')
    void startBookRun()
    await flush()
    expect(bookRuns.created[1]!.deps.startAt).toBe('s2')
  })

  it('a saved running run resumes from its cursor when the book opens', async () => {
    cacheStates[first] = 'cached'
    await save({ v: 2, status: 'running', cursor: 's4', startedAt: 7 })
    await activate(tab())
    await flush()
    expect(bookRuns.created).toHaveLength(1)
    expect(bookRuns.created[0]!.deps.startAt).toBe('s4')
    expect(pane.bookRun).toMatchObject({ status: 'understanding', finished: 1 })
  })

  it('shows the preparing step, then an error with a retry instead of preparing forever', async () => {
    files.get.mockResolvedValueOnce(undefined)
    const opening = activate(tab())
    expect(pane.bookRun.status).toBe('preparing')
    expect(pane.bookRun.preparing).toEqual({ label: 'Opening the book' })
    await opening
    expect(pane.bookRun.status).toBe('error')
    expect(pane.bookRun.message).toBe(
      'The EPUB file is unavailable. Re-open it from the library.',
    )
    expect(pane.bookRun.preparing).toBeNull()
    await retryActivate()
    await flush()
    expect(pane.bookRun).toMatchObject({ status: 'idle', total: 4 })
    // Only after a failure.
    const created = vi.mocked(createPipeline).mock.calls.length
    await retryActivate()
    expect(vi.mocked(createPipeline).mock.calls.length).toBe(created)
  })

  it('a confirm pressed while preparing is queued visibly and shown once ready, however long it takes', async () => {
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    let release!: () => void
    files.get.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = () =>
            r({ file: { arrayBuffer: async () => new ArrayBuffer(0) } })
        }),
    )
    const opening = activate(tab())
    await confirmBookRun()
    expect(pane.bookRun).toMatchObject({
      status: 'preparing',
      queued: 'confirm',
    })
    expect(bookRunText(pane.bookRun)).toContain('Will start when ready.')
    now += 5 * 60_000
    release()
    await opening
    await flush()
    expect(pane.bookRun).toMatchObject({ status: 'confirm', queued: null })
  })

  it('a start queued before the book is ready resumes a saved paused run once it is', async () => {
    await save({ v: 2, status: 'paused', cursor: 's2' })
    let release!: () => void
    files.get.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = () =>
            r({ file: { arrayBuffer: async () => new ArrayBuffer(0) } })
        }),
    )
    const opening = activate(tab())
    await startBookRun()
    expect(pane.bookRun.queued).toBe('start')
    release()
    await opening
    await flush()
    expect(bookRuns.created).toHaveLength(1)
    expect(bookRuns.created[0]!.deps.startAt).toBe('s2')
  })

  it('waiting for the previous run is bounded: abort, then go on after STOP_WAIT_MS', async () => {
    await activate(tab())
    void startBookRun()
    await flush()
    const [stuck] = bookRuns.created
    pauseBookRun()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    void resumeBookRun()
    await vi.advanceTimersByTimeAsync(0)
    expect(pane.bookRun.status).toBe('stopping')
    expect(stuck!.pause).toHaveBeenCalledTimes(2)
    const second = bookRuns.created[1]!
    expect(second.start).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(STOP_WAIT_MS)
    expect(second.start).toHaveBeenCalledOnce()
    expect(pane.bookRun.status).toBe('understanding')
  })

  it('stop ends the run and forgets its record, but keeps every cached visual', async () => {
    const repos = await getRepos()
    const plan = make.planRecord({ bookId, sectionId: first })
    await repos.plans.put(plan)
    cacheStates[first] = 'cached'
    await activate(tab())
    void startBookRun()
    await flush()
    expect(pane.runningBooks).toEqual([FLOW_ID])
    await stopBookRun()
    expect(bookRuns.created[0]!.pause).toHaveBeenCalledOnce()
    expect(await saved()).toEqual({})
    expect(pane.runningBooks).toEqual([])
    expect(pane.bookRun).toMatchObject({
      status: 'idle',
      cursor: null,
      startedAt: null,
      finished: 1,
      cachedCount: 1,
    })
    expect(await repos.plans.get(plan.cacheKey)).toEqual(plan)
    // Pause, unlike stop, keeps the record for Resume.
    void startBookRun()
    await flush()
    pauseBookRun()
    await flush()
    expect((await saved())[FLOW_ID]).toMatchObject({ status: 'paused' })
  })

  /** Keeps the book `preparing` (in its cache check) until the returned function is called. */
  const holdCacheCheck = () => {
    let release!: () => void
    cacheHold.promise = new Promise<void>((r) => (release = r))
    return () => {
      cacheHold.promise = null
      release()
    }
  }

  it("a book switch while preparing never writes into the new book's state", async () => {
    const repos = await getRepos()
    let release: (() => void) | undefined
    vi.spyOn(repos.sectionIndex, 'listByBook').mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = () => r([])
        }),
    )
    const opening = activate(tab())
    await vi.waitFor(() => expect(release).toBeDefined())
    deactivate() // Another book takes over the pane.
    pane.estimate = null
    pane.indexingApproved = false
    release!()
    await opening
    await flush()
    expect(pane.estimate).toBeNull()
    expect(pane.indexingApproved).toBe(false)
    expect(bridge.onLocationChange).not.toHaveBeenCalled()
  })

  it('wholeBook turned off during the cache check leaves the bar idle, not preparing', async () => {
    const release = holdCacheCheck()
    const opening = activate(tab())
    await vi.waitFor(() =>
      expect(pane.bookRun.preparing?.label).toBe(
        'Checking saved illustrations',
      ),
    )
    pane.preferences.flags = { ...pane.preferences.flags, wholeBook: false }
    release()
    await opening
    expect(pane.bookRun).toMatchObject({ status: 'idle', preparing: null })
  })

  it('wholeBook turned on over an open book prepares it and shows a queued confirm', async () => {
    cacheStates[first] = 'cached'
    pane.preferences.flags = { ...pane.preferences.flags, wholeBook: false }
    await activate(tab())
    expect(pane.bookRun).toMatchObject({ status: 'idle', total: 0 })
    await savePreferences({
      ...pane.preferences,
      flags: { ...pane.preferences.flags, wholeBook: true },
    })
    await flush()
    expect(pane.bookRun).toMatchObject({
      status: 'idle',
      total: 4,
      finished: 1,
    })
    await confirmBookRun()
    expect(pane.bookRun.status).toBe('confirm')
  })

  it('stop while preparing forgets a saved running run, so nothing starts once ready', async () => {
    await save({ v: 2, status: 'running', cursor: 's2' })
    const release = holdCacheCheck()
    const opening = activate(tab())
    await vi.waitFor(() =>
      expect(pane.bookRun.preparing?.label).toBe(
        'Checking saved illustrations',
      ),
    )
    await stopBookRun()
    expect(pane.bookRun.status).toBe('preparing')
    release()
    await opening
    await flush()
    expect(bookRuns.created).toHaveLength(0)
    expect(await saved()).toEqual({})
    expect(pane.bookRun).toMatchObject({ status: 'idle', cursor: null })
  })

  it("a run of a closed book never delays the next book's run", async () => {
    await activate(tab())
    void startBookRun()
    await flush()
    deactivate() // The run is paused but its start() never settles.
    await activate({ ...tab(), book: { id: 'other-book' } })
    void startBookRun()
    await flush()
    expect(bookRuns.created).toHaveLength(2)
    expect(bookRuns.created[1]!.start).toHaveBeenCalledOnce()
    expect(pane.bookRun.status).toBe('understanding')
  })

  it('pause during stopping keeps the run paused once the wait ends', async () => {
    await activate(tab())
    void startBookRun()
    await flush()
    pauseBookRun()
    void resumeBookRun()
    await flush()
    expect(pane.bookRun.status).toBe('stopping')
    pauseBookRun()
    expect(pane.bookRun.status).toBe('paused')
    bookRuns.created[0]!.settle('paused')
    await flush()
    expect(bookRuns.created[1]!.start).not.toHaveBeenCalled()
    expect(pane.bookRun.status).toBe('paused')
    expect((await saved())[FLOW_ID]).toMatchObject({ status: 'paused' })
  })

  it('reindex forgets the concept pass gaps', async () => {
    await activate(tab())
    await (await settings()).set(`conceptPass:${bookId}`, { failed: ['x'] })
    await reindex()
    expect(
      await (await settings()).get(`conceptPass:${bookId}`),
    ).toBeUndefined()
  })
})
