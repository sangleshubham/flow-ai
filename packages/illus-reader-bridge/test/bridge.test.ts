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
  it('returns a precise quotation CFI and keeps evidence/step marks separate on cleanup', async () => {
    const x = setup(); const cfi = await x.bridge.quoteToCfi(x.block.blockId, 'leader accepts client requests')
    expect(cfi).toBeTruthy(); expect(new EpubCFI(cfi!).toRange(document).toString()).toBe('leader accepts client requests')
    expect(await x.bridge.quoteToCfi('unknown', 'missing text')).toBeNull()
    x.bridge.highlight(cfi!, 'evidence'); x.bridge.highlight(x.block.cfiRange, 'step'); x.bridge.clearHighlights('evidence')
    expect(x.rendition.annotations.remove).toHaveBeenCalledTimes(1)
    expect(x.rendition.annotations.highlight).toHaveBeenCalledWith(cfi, {}, undefined, 'illus-evidence', expect.any(Object))
    x.bridge.dispose(); expect(x.rendition.annotations.remove).toHaveBeenCalledTimes(2)
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
