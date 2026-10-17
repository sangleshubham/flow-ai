import { makeBookId } from '@illus/core'
import { make } from '@illus/core/testing'
import type { BookRunDeps, BookRunProgress } from '@illus/pipeline'
import type { BridgeRendition } from '@illus/reader-bridge'
import type { EvidenceEvent } from '@illus/render'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Book } from '@flow/epubjs'

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
  resumeBookRun,
  savePreferences,
  startBookRun,
} from './runtime'
import { createPaneState, pane } from './state'

/** A whole-book run whose `start()` resolves only when the test settles it (as a real one does after `pause()`). */
interface FakeBookRun {
  deps: BookRunDeps
  start: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  settle(status: BookRunProgress['status'], o?: Partial<BookRunProgress>): void
}
const { bookRuns } = vi.hoisted(() => ({
  bookRuns: { created: [] as FakeBookRun[] },
}))
vi.mock('@illus/pipeline', async (importOriginal) => {
  const real = await importOriginal<typeof import('@illus/pipeline')>()
  return {
    ...real,
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
vi.mock('../db', () => ({
  db: {
    files: {
      get: async () => ({
        file: { arrayBuffer: async () => new ArrayBuffer(0) },
      }),
    },
  },
}))
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
    expect(await saved()).toEqual({ [FLOW_ID]: { status: 'running' } })
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
    expect(await saved()).toEqual({ [FLOW_ID]: { status: 'paused' } })

    const resumed = resumeBookRun()
    await flush()
    const second = bookRuns.created[1]!
    expect(second.start).not.toHaveBeenCalled()
    expect(pane.bookRun.status).toBe('understanding')
    first!.settle('paused', { finished: 7 })
    await flush()
    expect(second.start).toHaveBeenCalledOnce()
    expect(pane.bookRun.finished).toBe(0)
    expect(await saved()).toEqual({ [FLOW_ID]: { status: 'running' } })
    second.settle('done')
    await resumed
    expect(pane.bookRun.status).toBe('done')
  })

  it('stays paused after the plan limit until the user resumes after the reset', async () => {
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
    expect(await saved()).toEqual({
      [FLOW_ID]: { status: 'paused-limit', resetAt },
    })

    await resumeBookRun()
    expect(bookRuns.created).toHaveLength(1)
    expect(pane.bookRun.message).toMatch(
      /^Still paused by the ChatGPT plan limit until /,
    )
    pane.bookRun.resetAt = Date.now() - 1
    void resumeBookRun()
    await flush()
    expect(bookRuns.created).toHaveLength(2)
  })

  it('keeps a running book saved when the book closes and resumes it when it opens', async () => {
    await activate(tab())
    void startBookRun()
    await flush()
    deactivate()
    expect(bookRuns.created[0]!.pause).toHaveBeenCalledOnce()
    expect(pane.bookRun.status).toBe('idle')
    await flush()
    expect(await saved()).toEqual({ [FLOW_ID]: { status: 'running' } })
    expect(pane.runningBooks).toEqual([FLOW_ID])

    await activate(tab())
    await flush()
    expect(bookRuns.created).toHaveLength(2)
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
    expect(await saved()).toEqual({ [FLOW_ID]: { status: 'running' } })
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
    expect(await saved()).toEqual({ [FLOW_ID]: { status: 'paused' } })
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
