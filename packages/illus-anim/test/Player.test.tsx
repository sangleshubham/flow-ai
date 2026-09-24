import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  buildFrames,
  validateAnimation,
  validateAnimationWithRepair,
} from '@illus/core'
import { make } from '@illus/core/testing'
import { templateRegistry } from '@illus/render'
import { Player } from '../src/index.ts'
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
  it('auto advances at narration timing and clears book highlight on pause', () => {
    vi.useFakeTimers()
    const highlight = vi.fn()
    render(
      <Player
        frames={frames}
        renderFrame={(f) => <p>{f.step}</p>}
        onEvidenceHighlight={highlight}
      />,
    )
    fireEvent.click(screen.getByText('Play'))
    // Testing Library act flushes the timeout-driven state update.
    return import('@testing-library/react').then(({ act }) => {
      act(() => vi.advanceTimersByTime(1500))
      expect(screen.getByText('Compare adjacent values.')).toBeTruthy()
      expect(highlight).toHaveBeenLastCalledWith(evidence)
      fireEvent.click(screen.getByText('Pause'))
      expect(highlight).toHaveBeenLastCalledWith(null)
    })
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
      (screen.getByLabelText('Highlight passage while playing') as HTMLInputElement)
        .checked,
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
