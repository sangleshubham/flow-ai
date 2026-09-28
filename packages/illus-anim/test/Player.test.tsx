import { StrictMode } from 'react'
import type { Evidence } from '@illus/core'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  buildFrames,
  validateAnimation,
  validateAnimationWithRepair,
} from '@illus/core'
import { make } from '@illus/core/testing'
import { templateRegistry } from '@illus/render'
import { Player, useStepHighlight } from '../src/index.ts'
import {
  arrayIR,
  arrayAnimation,
  evidence,
  quote,
  sequenceIR,
  sequenceQuote,
} from './golden.ts'
import arrayFixture from '../../../fixtures/llm/animator/array-sort.json'
import sequenceFixture from '../../../fixtures/llm/animator/sequence-request.json'

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: true,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
const options = {
  templates: templateRegistry,
  grounding: {
    blocks: new Map([
      [
        evidence.blockId,
        make.block({ blockId: evidence.blockId, text: quote }),
      ],
    ]),
  },
}
const frames = buildFrames(arrayIR, arrayAnimation, {
  templates: templateRegistry,
})
describe('player', () => {
  it('applies configured speed to timing and preserves manual choice until settings change', () => {
    vi.useFakeTimers()
    const view = (defaultSpeed: number) => (
      <Player
        frames={frames}
        defaultSpeed={defaultSpeed}
        renderFrame={(f) => <p data-testid="frame">{f.step}</p>}
      />
    )
    const { rerender } = render(view(2))
    expect(
      (screen.getByLabelText('Playback speed') as HTMLSelectElement).value,
    ).toBe('2')
    fireEvent.click(screen.getByText('Play'))
    act(() => vi.advanceTimersByTime(749))
    expect(screen.getByTestId('frame').textContent).toBe('0')
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId('frame').textContent).toBe('1')
    fireEvent.click(screen.getByText('Pause'))
    fireEvent.change(screen.getByLabelText('Playback speed'), {
      target: { value: '1.5' },
    })
    rerender(view(2))
    expect(
      (screen.getByLabelText('Playback speed') as HTMLSelectElement).value,
    ).toBe('1.5')
    rerender(view(0.5))
    expect(
      (screen.getByLabelText('Playback speed') as HTMLSelectElement).value,
    ).toBe('0.5')
    rerender(view(0))
    expect(
      (screen.getByLabelText('Playback speed') as HTMLSelectElement).value,
    ).toBe('1')
  })
  it('explicit reduced-motion overrides can enable or disable the OS preference', () => {
    const view = (reducedMotion?: boolean) => (
      <Player
        frames={frames}
        renderFrame={(f) => <p>{f.step}</p>}
        reducedMotion={reducedMotion}
      />
    )
    const { rerender } = render(view(false))
    expect(screen.getByRole('region').getAttribute('data-reduced-motion')).toBe(
      'false',
    )
    rerender(view(true))
    expect(screen.getByRole('region').getAttribute('data-reduced-motion')).toBe(
      'true',
    )
    rerender(view())
    expect(screen.getByRole('region').getAttribute('data-reduced-motion')).toBe(
      'true',
    )
  })
  it('steps scrubs restarts and links narration evidence', () => {
    const step = vi.fn(),
      click = vi.fn()
    render(
      <Player
        frames={frames}
        renderFrame={(f) => <p data-testid="frame">{f.step}</p>}
        onStepChange={step}
        onEvidenceClick={click}
      />,
    )
    fireEvent.click(screen.getByLabelText('Next step'))
    expect(screen.getByTestId('frame').textContent).toBe('1')
    fireEvent.click(screen.getByText('Compare adjacent values.'))
    expect(click).toHaveBeenCalledWith(evidence)
    fireEvent.change(screen.getByLabelText('Animation step'), {
      target: { value: '3' },
    })
    expect(screen.getByTestId('frame').textContent).toBe('3')
    fireEvent.click(screen.getByText('Restart'))
    expect(step).toHaveBeenLastCalledWith(0)
    fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowRight' })
    expect(screen.getByTestId('frame').textContent).toBe('1')
    fireEvent.keyDown(screen.getByRole('region'), { key: 'Home' })
    expect(screen.getByTestId('frame').textContent).toBe('0')
    expect(screen.getByRole('region').getAttribute('data-reduced-motion')).toBe(
      'true',
    )
  })
  it('keeps highlighting paused steps and clears on frame zero, disabling, and unmount', () => {
    vi.useFakeTimers()
    const highlight = vi.fn()
    const { unmount } = render(
      <Player
        frames={frames}
        renderFrame={(f) => <p>{f.step}</p>}
        onEvidenceHighlight={highlight}
      />,
    )
    fireEvent.click(screen.getByText('Play'))
    act(() => vi.advanceTimersByTime(1500))
    expect(screen.getByText('Compare adjacent values.')).toBeTruthy()
    expect(highlight).toHaveBeenLastCalledWith(evidence)
    const beforePause = highlight.mock.calls.length
    fireEvent.click(screen.getByText('Pause'))
    expect(highlight).toHaveBeenCalledTimes(beforePause)
    expect(highlight).toHaveBeenLastCalledWith(evidence)
    fireEvent.click(screen.getByText('Restart'))
    expect(highlight).toHaveBeenLastCalledWith(null)
    fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowRight' })
    expect(highlight).toHaveBeenLastCalledWith(evidence)
    fireEvent.click(screen.getByLabelText('Highlight passage while playing'))
    expect(highlight).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByLabelText('Highlight passage while playing'))
    expect(highlight).toHaveBeenLastCalledWith(evidence)
    unmount()
    expect(highlight).toHaveBeenLastCalledWith(null)
  })
  it('lets the host control the checkbox without local changes after clicks', () => {
    const change = vi.fn(),
      highlight = vi.fn()
    const view = (checked: boolean) => (
      <Player
        frames={frames}
        renderFrame={(f) => <p>{f.step}</p>}
        highlightWhilePlaying={checked}
        onHighlightWhilePlayingChange={change}
        onEvidenceHighlight={highlight}
      />
    )
    const { rerender } = render(view(false))
    const toggle = screen.getByLabelText(
      'Highlight passage while playing',
    ) as HTMLInputElement
    fireEvent.click(screen.getByLabelText('Next step'))
    fireEvent.click(toggle)
    expect(change).toHaveBeenLastCalledWith(true)
    expect(toggle.checked).toBe(false)
    expect(highlight).toHaveBeenLastCalledWith(null)
    rerender(view(true))
    expect(toggle.checked).toBe(true)
    expect(highlight).toHaveBeenLastCalledWith(evidence)
    fireEvent.click(toggle)
    expect(change).toHaveBeenLastCalledWith(false)
    expect(toggle.checked).toBe(true)
    rerender(view(false))
    expect(toggle.checked).toBe(false)
    expect(highlight).toHaveBeenLastCalledWith(null)
  })
  it('keeps uncontrolled edits until the incoming highlight setting changes', () => {
    const view = (checked: boolean) => (
      <Player
        frames={frames}
        renderFrame={(f) => <p>{f.step}</p>}
        highlightWhilePlaying={checked}
      />
    )
    const { rerender } = render(view(true))
    const toggle = screen.getByLabelText(
      'Highlight passage while playing',
    ) as HTMLInputElement
    fireEvent.click(toggle)
    expect(toggle.checked).toBe(false)
    rerender(view(true))
    expect(toggle.checked).toBe(false)
    rerender(view(false))
    expect(toggle.checked).toBe(false)
    rerender(view(true))
    expect(toggle.checked).toBe(true)
  })
})
describe('step highlight hook', () => {
  function Hook({
    ev,
    enabled = true,
    callback,
  }: {
    ev?: Evidence
    enabled?: boolean
    callback?: (e: Evidence | null) => void
  }) {
    useStepHighlight({ evidence: ev, enabled, onEvidenceHighlight: callback })
    return null
  }
  it('compares passage fields and ignores callback identity without clearing between passages', () => {
    const highlight = vi.fn()
    const view = (ev: Evidence, enabled = true) => (
      <Hook ev={ev} enabled={enabled} callback={(e) => highlight(e)} />
    )
    const { rerender, unmount } = render(view(evidence))
    expect(highlight.mock.calls).toEqual([[evidence]])
    rerender(view({ ...evidence }))
    expect(highlight).toHaveBeenCalledTimes(1)
    for (const next of [
      { ...evidence, blockId: 'other' },
      { ...evidence, quote: 'Another passage' },
      { ...evidence, start: 1 },
      { ...evidence, start: 1, end: 5 },
    ]) {
      const count = highlight.mock.calls.length
      rerender(view(next))
      expect(highlight).toHaveBeenCalledTimes(count + 1)
      expect(highlight).toHaveBeenLastCalledWith(next)
    }
    rerender(view(evidence, false))
    expect(highlight).toHaveBeenLastCalledWith(null)
    const count = highlight.mock.calls.length
    rerender(view({ ...evidence, quote: 'Disabled change' }, false))
    expect(highlight).toHaveBeenCalledTimes(count)
    unmount()
    expect(highlight).toHaveBeenLastCalledWith(null)
  })
  it('clears missing evidence and uses the latest callback on unmount', () => {
    const first = vi.fn(),
      latest = vi.fn()
    const { rerender, unmount } = render(
      <Hook ev={evidence} callback={first} />,
    )
    rerender(<Hook ev={{ ...evidence }} callback={latest} />)
    expect(first.mock.calls).toEqual([[evidence]])
    expect(latest).not.toHaveBeenCalled()
    rerender(<Hook callback={latest} />)
    expect(latest.mock.calls).toEqual([[null]])
    unmount()
    expect(latest.mock.calls).toEqual([[null], [null]])
  })
  it('restores evidence after StrictMode replays mount effects', () => {
    const highlight = vi.fn()
    const { rerender, unmount } = render(
      <StrictMode>
        <Hook ev={evidence} callback={highlight} />
      </StrictMode>,
    )
    expect(highlight.mock.calls).toEqual([[evidence], [null], [evidence]])
    rerender(
      <StrictMode>
        <Hook ev={{ ...evidence }} callback={highlight} />
      </StrictMode>,
    )
    expect(highlight).toHaveBeenCalledTimes(3)
    unmount()
    expect(highlight).toHaveBeenLastCalledWith(null)
  })
})
describe('autoplay (ADR 0048)', () => {
  it('plays through once without a click and stops on the last frame', () => {
    vi.useFakeTimers()
    render(
      <Player
        frames={frames}
        autoPlay
        reducedMotion={false}
        highlightWhilePlaying={false}
        renderFrame={(f) => <p data-testid="frame">{f.step}</p>}
      />,
    )
    expect(screen.getByText('Pause')).toBeTruthy()
    for (let i = 0; i < frames.length + 2; i++)
      act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByTestId('frame').textContent).toBe(
      String(frames.length - 1),
    )
    expect(screen.getByText('Play')).toBeTruthy()
    expect(
      (
        screen.getByLabelText(
          'Highlight passage while playing',
        ) as HTMLInputElement
      ).checked,
    ).toBe(false)
  })
  it('never autoplays with reduced motion', () => {
    vi.useFakeTimers()
    render(
      <Player
        frames={frames}
        autoPlay
        reducedMotion
        renderFrame={(f) => <p data-testid="frame">{f.step}</p>}
      />,
    )
    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByTestId('frame').textContent).toBe('0')
    expect(screen.getByText('Play')).toBeTruthy()
  })
})
describe('every-frame validation', () => {
  it('handwritten replay examples parse and play against their permitted synthetic evidence', () => {
    expect(arrayFixture.source).toBe('handwritten')
    expect(sequenceFixture.effort).toBe('medium')
    expect(validateAnimation(arrayIR, arrayFixture.data, options).ok).toBe(true)
    const blocks = new Map([
      [
        'animation-sequence',
        make.block({ blockId: 'animation-sequence', text: sequenceQuote }),
      ],
    ])
    expect(
      validateAnimation(sequenceIR, sequenceFixture.data, {
        grounding: { blocks },
      }).ok,
    ).toBe(true)
  })
  it('grounds narration and rejects invented evidence', () => {
    expect(validateAnimation(arrayIR, arrayAnimation, options).ok).toBe(true)
    const bad = {
      ...arrayAnimation,
      steps: arrayAnimation.steps.map((s) => ({
        ...s,
        evidence: { ...s.evidence, quote: 'This quote was invented' },
      })),
    }
    expect(
      validateAnimation(arrayIR, bad, options).issues.some(
        (i) => i.code === 'animation-evidence',
      ),
    ).toBe(true)
  })
  it('rejects heap swaps that violate the claimed heap invariant', () => {
    const t = templateRegistry.getTemplate('tree')!
    const ir = {
      type: 'template' as const,
      templateId: 'tree' as const,
      props: t.example,
      evidence: [],
    }
    const bad = {
      ...arrayAnimation,
      initialHidden: [],
      steps: arrayAnimation.steps.slice(0, 2).map((s) => ({
        ...s,
        actions: [
          {
            op: 'swap' as const,
            a: 'node:h0' as const,
            b: 'node:h1' as const,
          },
        ],
      })),
    }
    expect(() => buildFrames(ir, bad, { templates: templateRegistry })).toThrow(
      /heap order/,
    )
  })
  it('clones container seeds and enforces capacity after push', () => {
    const props = { items: [{ id: 'a', value: 1 }], capacity: 1 }
    const ir = {
      type: 'template' as const,
      templateId: 'stack' as const,
      props,
      evidence: [],
    }
    const bad = {
      ...arrayAnimation,
      steps: arrayAnimation.steps.slice(0, 2).map((s) => ({
        ...s,
        actions: [
          { op: 'push' as const, container: 'stack', id: 'b', value: 2 },
        ],
      })),
    }
    expect(() => buildFrames(ir, bad, { templates: templateRegistry })).toThrow(
      /capacity/,
    )
    expect(props.items).toEqual([{ id: 'a', value: 1 }])
  })
  it('repairs once then returns static fallback', async () => {
    const repair = vi.fn().mockResolvedValue({})
    const result = await validateAnimationWithRepair(
      arrayIR,
      {},
      options,
      repair,
    )
    expect(repair).toHaveBeenCalledTimes(1)
    expect(result.staticFallback).toBe(true)
    const success = await validateAnimationWithRepair(
      arrayIR,
      {},
      options,
      async () => arrayAnimation,
    )
    expect(success.ok).toBe(true)
  })
})
