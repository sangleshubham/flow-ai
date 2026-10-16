import { StrictMode, useState } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { buildFrames } from '@illus/core'
import type { Evidence, GraphIR, SceneTimeline } from '@illus/core'
import { ScenePlayer } from '../src/index.ts'
import type { ScenePlayerProps } from '../src/index.ts'
import { evidence, hiddenGraphAnimation, hiddenGraphIR } from './golden.ts'

/** jsdom has no SVG geometry, so the GSAP half is replaced by a recording fake; it runs for real in e2e. */
const made = vi.hoisted(() => ({
  build: vi.fn(),
}))
vi.mock('../src/scene-timeline.ts', async (importOriginal) => {
  const actual: object = await importOriginal()
  return { ...actual, buildSceneTimeline: made.build }
})

interface Playhead {
  from: string
  to: string
  vars: { duration: number; ease: string }
  kill: ReturnType<typeof vi.fn>
}
interface Fake {
  svg: SVGSVGElement
  plan: SceneTimeline
  tl: {
    labels: Record<string, number>
    seek: ReturnType<typeof vi.fn>
    tweenFromTo: ReturnType<typeof vi.fn>
  }
  ctx: { revert: ReturnType<typeof vi.fn> }
  playheads: Playhead[]
}
let builds: Fake[] = []
beforeEach(() => {
  builds = []
  made.build.mockReset()
  made.build.mockImplementation((svg: SVGSVGElement, plan: SceneTimeline) => {
    const playheads: Playhead[] = []
    const fake: Fake = {
      svg,
      plan,
      tl: {
        labels: {
          s0: 0,
          ...Object.fromEntries(plan.steps.map((s) => [`s${s.index}`, s.end])),
        },
        seek: vi.fn(),
        tweenFromTo: vi.fn((from: string, to: string, vars) => {
          const playhead = { from, to, vars, kill: vi.fn() }
          playheads.push(playhead)
          return playhead
        }),
      },
      ctx: { revert: vi.fn() },
      playheads,
    }
    builds.push(fake)
    return fake
  })
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
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

if (hiddenGraphIR.type !== 'graph') throw new Error('Expected a graph fixture')
const ir: GraphIR = hiddenGraphIR
const frames = buildFrames(ir, hiddenGraphAnimation)
const targets = ['node:a', 'node:b', 'node:c', 'edge:ab', 'edge:bc']
/** What GraphView renders once its worker finished: a ready view with a laid-out SVG. */
const laidOut = (): ReactNode => (
  <div className="illus-view" data-ready="true">
    <svg data-layout="400 200">
      {targets.map((target, i) => (
        <g key={target} data-target={target} data-box={`${i * 60} 0 50 30`} />
      ))}
    </svg>
  </div>
)
const pending = (): ReactNode => (
  <div className="illus-view" data-ready="false">
    <p>Laying out…</p>
  </div>
)
const step = (index: number) => plan().steps[index - 1]!
const plan = () => builds[builds.length - 1]!.plan
const labels = () => builds[builds.length - 1]!.tl.labels

const view = (props: Partial<ScenePlayerProps> = {}) => (
  <ScenePlayer
    ir={ir}
    frames={frames}
    renderScene={laidOut}
    reducedMotion={false}
    {...props}
  />
)
const next = () => fireEvent.click(screen.getByLabelText('Next step'))
const stepNumber = () => screen.getByLabelText('Step number').textContent
const checkbox = () =>
  screen.getByLabelText('Highlight passage while playing') as HTMLInputElement

describe('before the layout exists', () => {
  it('shows the static scene with every transport control disabled and builds nothing', () => {
    const onStep = vi.fn()
    render(view({ renderScene: pending, onStepChange: onStep }))
    expect(screen.getByText('Laying out…')).toBeTruthy()
    for (const control of [
      screen.getByText('Restart').closest('button'),
      screen.getByLabelText('Previous step'),
      screen.getByText('Play').closest('button'),
      screen.getByLabelText('Next step'),
      screen.getByLabelText('Animation step'),
      screen.getByLabelText('Playback speed'),
      screen.getByLabelText('Loop'),
    ])
      expect((control as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('region').getAttribute('data-scene-ready')).toBe(
      'false',
    )
    expect(made.build).not.toHaveBeenCalled()
    expect(onStep).toHaveBeenCalledWith(0)
    // Keys do nothing either: there is no picture to move.
    fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowRight' })
    expect(stepNumber()).toBe('0/2')
    // The highlight option is not part of the transport.
    expect(checkbox().disabled).toBe(false)
  })
  it('waits when the view is ready but its SVG carries no layout', () => {
    render(
      view({
        renderScene: () => (
          <div className="illus-view" data-ready="true">
            <svg />
          </div>
        ),
      }),
    )
    expect(
      (screen.getByLabelText('Next step') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(made.build).not.toHaveBeenCalled()
  })
  it('enables the controls when the layout arrives, building once for the laid-out SVG', async () => {
    let finish!: () => void
    function Late() {
      const [done, setDone] = useState(false)
      finish = () => setDone(true)
      return <>{done ? laidOut() : pending()}</>
    }
    const lateScene = () => <Late />
    render(view({ renderScene: lateScene }))
    expect(made.build).not.toHaveBeenCalled()
    await act(async () => {
      finish()
    })
    expect(made.build).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('region').getAttribute('data-scene-ready')).toBe(
      'true',
    )
    expect(
      (screen.getByLabelText('Next step') as HTMLButtonElement).disabled,
    ).toBe(false)
  })
  it('renders the scene once, whatever the step', () => {
    const scene = vi.fn(laidOut)
    render(view({ renderScene: scene }))
    next()
    next()
    expect(scene).toHaveBeenCalledTimes(1)
  })
  it('shows a message and no controls without frames', () => {
    render(view({ frames: [] }))
    expect(screen.getByText('No animation frames available.')).toBeTruthy()
    expect(screen.queryByLabelText('Next step')).toBeNull()
    expect(made.build).not.toHaveBeenCalled()
  })
})

describe('building the timeline', () => {
  it('compiles the plan from the SVG geometry and starts on scene 0', () => {
    render(view())
    expect(made.build).toHaveBeenCalledTimes(1)
    const [svg, built] = made.build.mock.calls[0]!
    expect((svg as SVGSVGElement).getAttribute('data-layout')).toBe('400 200')
    expect((built as SceneTimeline).steps).toHaveLength(frames.length - 1)
    expect(builds[0]!.tl.seek).toHaveBeenLastCalledWith('s0')
    expect(screen.getByRole('region').getAttribute('data-scene-ready')).toBe(
      'true',
    )
  })
  it('rebuilds after reverting for new frames, and starts again at the base frame', () => {
    const { rerender } = render(view())
    next()
    expect(stepNumber()).toBe('1/2')
    const again = buildFrames(ir, hiddenGraphAnimation)
    rerender(view({ frames: again }))
    expect(builds).toHaveLength(2)
    expect(builds[0]!.ctx.revert).toHaveBeenCalledTimes(1)
    expect(builds[1]!.tl.seek).toHaveBeenLastCalledWith('s0')
    expect(stepNumber()).toBe('0/2')
  })
  it('rebuilds for a new graph and for a replaced SVG, keeping the step', () => {
    const { rerender } = render(view())
    next()
    rerender(view({ ir: { ...ir } }))
    expect(builds).toHaveLength(2)
    expect(builds[0]!.ctx.revert).toHaveBeenCalledTimes(1)
    // Same frames, so the index survives; the new timeline lands on it without playing.
    expect(stepNumber()).toBe('1/2')
    expect(builds[1]!.tl.seek).toHaveBeenLastCalledWith('s1')
    expect(builds[1]!.tl.tweenFromTo).not.toHaveBeenCalled()
    rerender(
      view({
        ir: { ...ir },
        renderScene: () => (
          <div className="illus-view" data-ready="true">
            <svg data-layout="500 250">
              {targets.map((target, i) => (
                <g
                  key={target}
                  data-target={target}
                  data-box={`${i * 70} 0 50 30`}
                />
              ))}
            </svg>
          </div>
        ),
      }),
    )
    expect(builds).toHaveLength(3)
    expect(builds[1]!.ctx.revert).toHaveBeenCalledTimes(1)
    expect(builds[2]!.svg.getAttribute('data-layout')).toBe('500 250')
    expect(builds[2]!.tl.seek).toHaveBeenLastCalledWith('s1')
    expect(builds[2]!.tl.tweenFromTo).not.toHaveBeenCalled()
  })
  it('reverts on unmount', () => {
    const { unmount } = render(view())
    next()
    unmount()
    expect(builds[0]!.ctx.revert).toHaveBeenCalledTimes(1)
  })
  it('keeps one live timeline under StrictMode, without needless rebuilds', () => {
    render(<StrictMode>{view()}</StrictMode>)
    expect(builds).toHaveLength(1)
    expect(builds[0]!.ctx.revert).not.toHaveBeenCalled()
    next()
    expect(builds[0]!.tl.tweenFromTo).toHaveBeenCalledTimes(1)
  })
  it('stays on the static scene when building throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    made.build.mockImplementation(() => {
      throw new Error('Scene graph layout is not ready')
    })
    render(view())
    expect(
      (screen.getByLabelText('Next step') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('moving the playhead', () => {
  it('plays one step forward as a linear playhead tween between the step labels', () => {
    render(view())
    next()
    const [playhead] = builds[0]!.playheads
    expect(builds[0]!.tl.tweenFromTo).toHaveBeenCalledTimes(1)
    expect(playhead).toMatchObject({
      from: 's0',
      to: 's1',
      vars: { ease: 'none' },
    })
    expect(playhead!.vars.duration).toBeCloseTo(labels().s1! - labels().s0!)
    next()
    expect(builds[0]!.playheads[1]).toMatchObject({ from: 's1', to: 's2' })
    expect(builds[0]!.playheads[1]!.vars.duration).toBeCloseTo(
      labels().s2! - labels().s1!,
    )
  })
  it('divides the tween duration by the speed', () => {
    render(view())
    fireEvent.change(screen.getByLabelText('Playback speed'), {
      target: { value: '2' },
    })
    next()
    expect(builds[0]!.playheads[0]!.vars.duration).toBeCloseTo(
      (labels().s1! - labels().s0!) / 2,
    )
  })
  it('kills a running playhead before starting the next one', () => {
    render(view())
    next()
    const [first] = builds[0]!.playheads
    expect(first!.kill).not.toHaveBeenCalled()
    next()
    expect(first!.kill).toHaveBeenCalledTimes(1)
    expect(builds[0]!.playheads).toHaveLength(2)
  })
  it('jumps for back, scrub, restart and key moves, killing the running tween', () => {
    render(view())
    const timeline = builds[0]!.tl
    next()
    const [running] = builds[0]!.playheads
    fireEvent.click(screen.getByText('Restart'))
    expect(running!.kill).toHaveBeenCalledTimes(1)
    expect(timeline.seek).toHaveBeenLastCalledWith('s0')
    // Scrubbing from the start straight to the end is not "one step forward".
    fireEvent.change(screen.getByLabelText('Animation step'), {
      target: { value: '2' },
    })
    expect(timeline.seek).toHaveBeenLastCalledWith('s2')
    fireEvent.click(screen.getByLabelText('Previous step'))
    expect(timeline.seek).toHaveBeenLastCalledWith('s1')
    expect(timeline.tweenFromTo).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowRight' })
    expect(timeline.tweenFromTo).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(screen.getByRole('region'), { key: 'Home' })
    expect(timeline.seek).toHaveBeenLastCalledWith('s0')
    expect(builds[0]!.playheads[1]!.kill).toHaveBeenCalledTimes(1)
    expect(stepNumber()).toBe('0/2')
  })
  it('does not replay when only the speed changes', () => {
    render(view())
    next()
    fireEvent.change(screen.getByLabelText('Playback speed'), {
      target: { value: '0.5' },
    })
    expect(builds[0]!.tl.tweenFromTo).toHaveBeenCalledTimes(1)
  })
  it('seeks, never tweens, with reduced motion', () => {
    render(view({ reducedMotion: true }))
    expect(screen.getByRole('region').getAttribute('data-reduced-motion')).toBe(
      'true',
    )
    next()
    expect(builds[0]!.tl.seek).toHaveBeenLastCalledWith('s1')
    next()
    expect(builds[0]!.tl.seek).toHaveBeenLastCalledWith('s2')
    expect(builds[0]!.tl.tweenFromTo).not.toHaveBeenCalled()
  })
  it('kills the running tween when it unmounts', () => {
    const { unmount } = render(view())
    next()
    unmount()
    expect(builds[0]!.playheads[0]!.kill).toHaveBeenCalled()
  })
})

describe('auto-advance', () => {
  it('waits for the narration plus the step choreography, divided by the speed', () => {
    vi.useFakeTimers()
    render(view({ defaultSpeed: 2 }))
    fireEvent.click(screen.getByText('Play'))
    // Index 0 has no step and no narration: the 1500 ms floor.
    act(() => vi.advanceTimersByTime(749))
    expect(stepNumber()).toBe('0/2')
    act(() => vi.advanceTimersByTime(1))
    expect(stepNumber()).toBe('1/2')
    const wait = (1500 + (step(1).end - step(1).start) * 1000) / 2
    act(() => vi.advanceTimersByTime(Math.floor(wait) - 1))
    expect(stepNumber()).toBe('1/2')
    act(() => vi.advanceTimersByTime(2))
    expect(stepNumber()).toBe('2/2')
    expect(builds[0]!.tl.tweenFromTo).toHaveBeenCalledTimes(2)
    // The last step ends playback.
    act(() => vi.advanceTimersByTime(60_000))
    expect(stepNumber()).toBe('2/2')
    expect(screen.getByText('Play')).toBeTruthy()
  })
  it('lengthens the wait for long narration', () => {
    vi.useFakeTimers()
    const long = 'x'.repeat(100)
    const longer = frames.map((frame, i) =>
      i === 1 ? { ...frame, narration: long } : frame,
    )
    render(view({ frames: longer }))
    fireEvent.click(screen.getByText('Play'))
    act(() => vi.advanceTimersByTime(1500))
    const wait = 100 * 45 + (step(1).end - step(1).start) * 1000
    act(() => vi.advanceTimersByTime(Math.floor(wait) - 1))
    expect(stepNumber()).toBe('1/2')
    act(() => vi.advanceTimersByTime(2))
    expect(stepNumber()).toBe('2/2')
  })
})

describe('autoplay (ADR 0048)', () => {
  it('plays through once without a click and ends on the full picture', () => {
    vi.useFakeTimers()
    render(view({ autoPlay: true, highlightWhilePlaying: false }))
    expect(screen.getByText('Pause')).toBeTruthy()
    for (let i = 0; i < frames.length + 2; i++)
      act(() => vi.advanceTimersByTime(10_000))
    expect(stepNumber()).toBe(`${frames.length - 1}/${frames.length - 1}`)
    expect(screen.getByText('Play')).toBeTruthy()
    expect(builds[0]!.tl.tweenFromTo).toHaveBeenCalledTimes(frames.length - 1)
    expect(checkbox().checked).toBe(false)
  })
  it('never autoplays with reduced motion', () => {
    vi.useFakeTimers()
    render(view({ autoPlay: true, reducedMotion: true }))
    act(() => vi.advanceTimersByTime(10_000))
    expect(stepNumber()).toBe('0/2')
    expect(screen.getByText('Play')).toBeTruthy()
  })
  it('starts only once the timeline exists', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    function Late() {
      const [done, setDone] = useState(false)
      finish = () => setDone(true)
      return <>{done ? laidOut() : pending()}</>
    }
    const lateScene = () => <Late />
    render(view({ autoPlay: true, renderScene: lateScene }))
    act(() => vi.advanceTimersByTime(30_000))
    expect(stepNumber()).toBe('0/2')
    expect(screen.getByText('Play')).toBeTruthy()
    await act(async () => {
      finish()
    })
    expect(screen.getByText('Pause')).toBeTruthy()
    act(() => vi.advanceTimersByTime(1500))
    expect(stepNumber()).toBe('1/2')
  })
  it('plays again for new frames, but not when only the graph is rebuilt', () => {
    vi.useFakeTimers()
    const { rerender } = render(view({ autoPlay: true }))
    for (let i = 0; i < frames.length + 2; i++)
      act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByText('Play')).toBeTruthy()
    rerender(view({ autoPlay: true, ir: { ...ir } }))
    expect(screen.getByText('Play')).toBeTruthy()
    rerender(
      view({
        autoPlay: true,
        ir: { ...ir },
        frames: buildFrames(ir, hiddenGraphAnimation),
      }),
    )
    expect(screen.getByText('Pause')).toBeTruthy()
    expect(stepNumber()).toBe('0/2')
  })
})

describe('narration and evidence', () => {
  it('shows the narration in a live region and sends its evidence on click', () => {
    const click = vi.fn()
    render(view({ onEvidenceClick: click }))
    const region = document.querySelector('.illus-narration')!
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('Initial state')
    next()
    expect(region.textContent).toBe('Show B.')
    fireEvent.click(screen.getByText('Show B.'))
    expect(click).toHaveBeenCalledWith(evidence)
  })
  it('reports every step change', () => {
    const changed = vi.fn()
    render(view({ onStepChange: changed }))
    next()
    fireEvent.click(screen.getByText('Restart'))
    expect(changed.mock.calls).toEqual([[0], [1], [0]])
  })
})

describe('step highlight', () => {
  it('keeps highlighting paused steps and clears on frame zero, disabling, and unmount', () => {
    vi.useFakeTimers()
    const highlight = vi.fn()
    const { unmount } = render(view({ onEvidenceHighlight: highlight }))
    fireEvent.click(screen.getByText('Play'))
    act(() => vi.advanceTimersByTime(1500))
    expect(screen.getByText('Show B.')).toBeTruthy()
    expect(highlight).toHaveBeenLastCalledWith(evidence)
    const beforePause = highlight.mock.calls.length
    fireEvent.click(screen.getByText('Pause'))
    expect(highlight).toHaveBeenCalledTimes(beforePause)
    expect(highlight).toHaveBeenLastCalledWith(evidence)
    fireEvent.click(screen.getByText('Restart'))
    expect(highlight).toHaveBeenLastCalledWith(null)
    fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowRight' })
    expect(highlight).toHaveBeenLastCalledWith(evidence)
    fireEvent.click(checkbox())
    expect(highlight).toHaveBeenLastCalledWith(null)
    fireEvent.click(checkbox())
    expect(highlight).toHaveBeenLastCalledWith(evidence)
    unmount()
    expect(highlight).toHaveBeenLastCalledWith(null)
  })
  it('lets the host control the checkbox without local changes after clicks', () => {
    const change = vi.fn(),
      highlight = vi.fn()
    const controlled = (checked: boolean) =>
      view({
        highlightWhilePlaying: checked,
        onHighlightWhilePlayingChange: change,
        onEvidenceHighlight: highlight as (e: Evidence | null) => void,
      })
    const { rerender } = render(controlled(false))
    const toggle = checkbox()
    next()
    fireEvent.click(toggle)
    expect(change).toHaveBeenLastCalledWith(true)
    expect(toggle.checked).toBe(false)
    expect(highlight).toHaveBeenLastCalledWith(null)
    rerender(controlled(true))
    expect(toggle.checked).toBe(true)
    expect(highlight).toHaveBeenLastCalledWith(evidence)
    fireEvent.click(toggle)
    expect(change).toHaveBeenLastCalledWith(false)
    expect(toggle.checked).toBe(true)
    rerender(controlled(false))
    expect(toggle.checked).toBe(false)
    expect(highlight).toHaveBeenLastCalledWith(null)
  })
  it('keeps uncontrolled edits until the incoming highlight setting changes', () => {
    const uncontrolled = (checked: boolean) =>
      view({ highlightWhilePlaying: checked })
    const { rerender } = render(uncontrolled(true))
    const toggle = checkbox()
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    expect(toggle.checked).toBe(false)
    rerender(uncontrolled(true))
    expect(toggle.checked).toBe(false)
    rerender(uncontrolled(false))
    expect(toggle.checked).toBe(false)
    rerender(uncontrolled(true))
    expect(toggle.checked).toBe(true)
  })
  it('sends no passage for the base frame while the layout is pending', () => {
    const highlight = vi.fn()
    render(view({ renderScene: pending, onEvidenceHighlight: highlight }))
    // Frame 0 has no passage.
    expect(highlight).toHaveBeenLastCalledWith(null)
  })
})
