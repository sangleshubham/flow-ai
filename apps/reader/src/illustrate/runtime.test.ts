import { makeBookId } from '@illus/core'
import { make } from '@illus/core/testing'
import type { BridgeRendition } from '@illus/reader-bridge'
import type { EvidenceEvent } from '@illus/render'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Book } from '@flow/epubjs'

import {
  activate,
  deactivate,
  getRepos,
  highlightEvidence,
  loadPreferences,
  savePreferences,
} from './runtime'
import { createPaneState, pane } from './state'

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
