// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { make } from '@illus/core/testing'

import { MermaidView } from '../src/mermaid/MermaidView.tsx'
import { renderMermaidSvg } from '../src/mermaid/render.ts'

vi.mock('../src/mermaid/render.ts', () => ({
  renderMermaidSvg: vi.fn(() => Promise.resolve('<svg></svg>')),
  tagMermaid: vi.fn(),
}))

afterEach(cleanup)

describe('MermaidView', () => {
  it('redraws on content change, not on a new but equal ir object', async () => {
    const ir = make.sequenceIR()
    const theme = make.themeTokens()
    const onReady = vi.fn()
    const onError = vi.fn()
    const { rerender } = render(<MermaidView ir={ir} theme={theme} onReady={onReady} onError={onError} />)
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
    rerender(<MermaidView ir={structuredClone(ir)} theme={{ ...theme }} onReady={onReady} onError={onError} />)
    expect(renderMermaidSvg).toHaveBeenCalledTimes(1)
    rerender(<MermaidView ir={{ ...ir, title: 'Changed' }} theme={theme} onReady={onReady} onError={onError} />)
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(2))
    expect(renderMermaidSvg).toHaveBeenCalledTimes(2)
  })
})
