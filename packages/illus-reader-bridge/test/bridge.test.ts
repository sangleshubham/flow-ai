import { EpubCFI } from '@flow/epubjs'
import { make } from '@illus/core/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReaderBridge } from '../src/index.ts'
import type { BridgeContents, BridgeRendition } from '../src/index.ts'

function setup() {
  document.body.innerHTML = '<p>The leader accepts <b>client requests</b> and appends a command.</p>'
  const sections = [make.sectionNode({ sectionId: 'a', spineIndex: 0, cfiStart: 'epubcfi(/6/2!/4/2)', cfiEnd: 'epubcfi(/6/2!/4/4)' }), make.sectionNode({ sectionId: 'b', spineIndex: 0, ordinal: 2, cfiStart: 'epubcfi(/6/2!/4/4)', cfiEnd: 'epubcfi(/6/2!/4/6)' })]
  const range = document.createRange(); const p = document.querySelector('p')!
  range.setStart(p.firstChild!, 0); range.setEnd(p.lastChild!, p.lastChild!.textContent!.length)
  const block = make.block({ cfiRange: new EpubCFI(range, '/6/2').toString() })
  const events = new Map<string, (...args: never[]) => void>()
  const contents: BridgeContents = { sectionIndex: 0, document, range: (cfi) => new EpubCFI(cfi).toRange(document), cfiFromRange: (r) => new EpubCFI(r, '/6/2').toString() }
  const rendition: BridgeRendition = { on: (event, cb) => events.set(event, cb), off: (event) => events.delete(event), display: vi.fn().mockResolvedValue(undefined), currentLocation: () => ({ start: { cfi: 'epubcfi(/6/2!/4/2)' } }), getContents: () => [contents], annotations: { highlight: vi.fn(), remove: vi.fn() } }
  const bridge = createReaderBridge({ bookId: 'book', rendition, sections: () => sections, blocks: () => [block] })
  const emit = (event: string, ...args: unknown[]) => events.get(event)?.(...args as never[])
  return { bridge, rendition, sections, contents, block, emit, events }
}
afterEach(() => vi.useRealTimers())
describe('ReaderBridge lifecycle', () => {
  it('debounces 400ms, suppresses section repeats, resolves merges and cleans all listeners', async () => {
    vi.useFakeTimers(); const x = setup(); const cb = vi.fn(); x.bridge.onLocationChange(cb)
    await Promise.resolve(); await vi.advanceTimersByTimeAsync(399); expect(cb).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1); expect(cb).toHaveBeenCalledWith(expect.objectContaining({ sectionId: 'a' }))
    x.emit('relocated', { start: { cfi: 'epubcfi(/6/2!/4/2/1:4)' } }); await vi.advanceTimersByTimeAsync(400); expect(cb).toHaveBeenCalledTimes(1)
    x.sections[1]!.mergedInto = 'a'; x.emit('relocated', { start: { cfi: 'epubcfi(/6/2!/4/4)' } }); await vi.advanceTimersByTimeAsync(400); expect(cb).toHaveBeenCalledTimes(1)
    x.bridge.dispose(); expect(x.events.size).toBe(0)
  })
  it('uses the last heading that starts on the visible page', async () => {
    vi.useFakeTimers()
    const x = setup()
    const cb = vi.fn()
    x.bridge.onLocationChange(cb)
    await Promise.resolve()
    x.emit('relocated', {
      start: { cfi: 'epubcfi(/6/2!/4/2/1:3)' },
      end: { cfi: 'epubcfi(/6/2!/4/6)' },
    })
    await vi.advanceTimersByTimeAsync(400)
    expect(cb).toHaveBeenLastCalledWith(
      expect.objectContaining({ sectionId: 'b' }),
    )
    x.bridge.dispose()
  })
  it.each(['setTarget', 'illus:navigate'])(
    'honours %s until paging away and does not reuse it on return',
    async (channel) => {
      vi.useFakeTimers()
      const x = setup()
      const cb = vi.fn()
      x.bridge.onLocationChange(cb)
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(400)
      if (channel === 'setTarget') x.bridge.setTarget(x.sections[0]!.cfiStart)
      else x.emit(channel, x.sections[0]!.cfiStart)
      const page = {
        start: { cfi: x.sections[0]!.cfiStart },
        end: { cfi: 'epubcfi(/6/2!/4/6)' },
      }
      x.emit('relocated', page)
      await vi.advanceTimersByTimeAsync(400)
      expect(cb).toHaveBeenCalledTimes(2) // a repeated section is republished after explicit navigation
      expect(cb).toHaveBeenLastCalledWith(
        expect.objectContaining({ sectionId: 'a' }),
      )
      x.emit('relocated', {
        start: { cfi: 'epubcfi(/6/2!/4/4/1:2)' },
        end: { cfi: 'epubcfi(/6/2!/4/6)' },
      })
      await vi.advanceTimersByTimeAsync(400)
      expect(cb).toHaveBeenLastCalledWith(
        expect.objectContaining({ sectionId: 'b' }),
      )
      x.emit('relocated', page)
      await vi.advanceTimersByTimeAsync(400)
      expect(cb).toHaveBeenCalledTimes(3)
      expect(cb).toHaveBeenLastCalledWith(
        expect.objectContaining({ sectionId: 'b' }),
      )
      x.bridge.dispose()
      expect(x.events.size).toBe(0)
    },
  )
  it('sets the scroll target before display can emit a relocation', async () => {
    vi.useFakeTimers()
    const x = setup()
    const cb = vi.fn()
    x.bridge.onLocationChange(cb)
    await Promise.resolve()
    vi.mocked(x.rendition.display).mockImplementation(async (cfi) => {
      x.emit('relocated', {
        start: { cfi },
        end: { cfi: 'epubcfi(/6/2!/4/6)' },
      })
    })
    await x.bridge.scrollTo(x.sections[0]!.cfiStart)
    await vi.advanceTimersByTimeAsync(400)
    expect(cb).toHaveBeenLastCalledWith(
      expect.objectContaining({ sectionId: 'a' }),
    )
    x.bridge.dispose()
  })
  it('keeps an unseen target pending while other pages use the page rule', async () => {
    vi.useFakeTimers()
    const x = setup()
    const cb = vi.fn()
    x.bridge.onLocationChange(cb)
    await Promise.resolve()
    x.bridge.setTarget(x.sections[0]!.cfiStart)
    x.emit('relocated', {
      start: { cfi: 'epubcfi(/6/2!/4/4/1:2)' },
      end: { cfi: 'epubcfi(/6/2!/4/6)' },
    })
    await vi.advanceTimersByTimeAsync(400)
    expect(cb).toHaveBeenLastCalledWith(
      expect.objectContaining({ sectionId: 'b' }),
    )
    x.emit('relocated', {
      start: { cfi: x.sections[0]!.cfiStart },
      end: { cfi: 'epubcfi(/6/2!/4/6)' },
    })
    await vi.advanceTimersByTimeAsync(400)
    expect(cb).toHaveBeenLastCalledWith(
      expect.objectContaining({ sectionId: 'a' }),
    )
    x.bridge.dispose()
  })
  it('preserves start-only resolution when a relocation has no page end', async () => {
    vi.useFakeTimers()
    const x = setup()
    const cb = vi.fn()
    x.bridge.onLocationChange(cb)
    await Promise.resolve()
    x.bridge.setTarget(x.sections[1]!.cfiStart)
    x.emit('relocated', { start: { cfi: x.sections[0]!.cfiStart } })
    await vi.advanceTimersByTimeAsync(400)
    expect(cb).toHaveBeenLastCalledWith(
      expect.objectContaining({ sectionId: 'a' }),
    )
    x.bridge.dispose()
  })
  it('ignores navigation events that do not carry a CFI', async () => {
    vi.useFakeTimers()
    const x = setup()
    const cb = vi.fn()
    x.bridge.onLocationChange(cb)
    await Promise.resolve()
    x.bridge.setTarget(x.sections[0]!.cfiStart)
    x.emit('illus:navigate', 'chapter.xhtml#b')
    x.emit('illus:navigate', {})
    x.emit('relocated', {
      start: { cfi: x.sections[0]!.cfiStart },
      end: { cfi: 'epubcfi(/6/2!/4/6)' },
    })
    await vi.advanceTimersByTimeAsync(400)
    expect(cb).toHaveBeenLastCalledWith(
      expect.objectContaining({ sectionId: 'a' }),
    )
    x.bridge.dispose()
  })
  it('returns a precise quotation CFI and keeps evidence/step marks separate on cleanup', async () => {
    const x = setup(); const cfi = await x.bridge.quoteToCfi(x.block.blockId, 'leader accepts client requests')
    expect(cfi).toBeTruthy(); expect(new EpubCFI(cfi!).toRange(document).toString()).toBe('leader accepts client requests')
    expect(await x.bridge.quoteToCfi('unknown', 'missing text')).toBeNull()
    x.bridge.highlight(cfi!, 'evidence'); x.bridge.highlight(x.block.cfiRange, 'step'); x.bridge.clearHighlights('evidence')
    expect(x.rendition.annotations.remove).toHaveBeenCalledTimes(1)
    expect(x.rendition.annotations.highlight).toHaveBeenCalledWith(cfi, {}, undefined, 'illus-evidence', expect.any(Object))
    x.bridge.dispose(); expect(x.rendition.annotations.remove).toHaveBeenCalledTimes(2)
  })
  it('keeps a clicked evidence mark when a step highlights and clears the same passage', () => {
    const x = setup(); const cfi = x.block.cfiRange
    x.bridge.highlight(cfi, 'evidence'); x.bridge.highlight(cfi, 'step'); x.bridge.clearHighlights('step')
    expect(x.rendition.annotations.highlight).toHaveBeenCalledTimes(1)
    expect(x.rendition.annotations.remove).not.toHaveBeenCalled()
    x.bridge.highlight(cfi, 'evidence'); expect(x.rendition.annotations.remove).toHaveBeenCalledTimes(1)
  })
  it('reports selected indexed blocks and publishes theme changes', async () => {
    const x = setup(); const selection = vi.fn(); const theme = vi.fn(); x.bridge.onSelection(selection); x.bridge.onThemeChange(theme)
    x.emit('selected', x.block.cfiRange, x.contents)
    expect(selection).toHaveBeenCalledWith(expect.objectContaining({ blockIds: [x.block.blockId] }))
    document.documentElement.classList.add('dark'); await Promise.resolve()
    expect(theme).toHaveBeenCalledWith(expect.objectContaining({ dark: true }))
    x.bridge.dispose(); document.documentElement.classList.remove('dark')
  })
})
