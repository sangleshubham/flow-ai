// @vitest-environment jsdom
import { Player, ScenePlayer } from '@illus/anim'
import { buildFrames, resolveFlags } from '@illus/core'
import type { FlagName, VisualRecord } from '@illus/core'
import { make } from '@illus/core/testing'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RecordView } from './RecordView'
import { highlightEvidence, savePreferences } from './runtime'
import { DEFAULT_PREFERENCES, pane } from './state'

const mocks = vi.hoisted(() => ({ visualProps: [] as any[] }))

// Real GSAP needs SVG geometry that jsdom lacks (the scene timeline has its own browser e2e): these tests
// are about which player the pane picks and how it feeds it. Both real players are kept and spied on.
vi.mock('@illus/anim', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@illus/anim')>()
  return {
    ...actual,
    Player: vi.fn(actual.Player),
    ScenePlayer: vi.fn(actual.ScenePlayer),
  }
})
// buildFrames is real unless a test replaces it for one call.
vi.mock('@illus/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@illus/core')>()
  return { ...actual, buildFrames: vi.fn(actual.buildFrames) }
})
// VisualView lays graphs out in a worker: replace it with a probe that shows the frame it was asked for.
vi.mock('@illus/render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@illus/render')>()
  return {
    ...actual,
    VisualView: (props: any) => {
      mocks.visualProps.push(props)
      return (
        <div
          data-testid="visual"
          data-frame={props.frame ? String(props.frame.step) : 'static'}
          data-expanded-prop={String(!!props.actions?.expanded)}
        >
          <button type="button" onClick={() => props.actions.onExpand()}>
            Expand visual
          </button>
        </div>
      )
    },
  }
})
vi.mock('./runtime', async () => {
  const { IR } = await import('@illus/core')
  return {
    activeSections: () => [],
    enabledKinds: () => [],
    getRepos: vi.fn(async () => ({})),
    highlightEvidence: vi.fn(async () => {}),
    parsedVisual: (record: VisualRecord) => IR.safeParse(record.ir),
    requestVisual: vi.fn(),
    saveConceptLayout: vi.fn(),
    savePreferences: vi.fn(async () => {}),
    updateRecord: vi.fn(async () => {}),
  }
})

const flags = (on: Partial<Record<FlagName, boolean>>) => {
  pane.preferences = {
    ...DEFAULT_PREFERENCES,
    flags: resolveFlags({ animations: true, sceneAnimations: false, ...on }),
  }
}
const sequence = () =>
  make.visualRecord({
    kind: 'sequence',
    ir: make.sequenceIR(),
    animation: make.animationIR({
      initialHidden: [],
      steps: [
        make.step({
          actions: [{ op: 'highlight', target: 'node:client', tone: 'focus' }],
        }),
        make.step({
          id: 's2',
          actions: [{ op: 'highlight', target: 'node:leader', tone: 'focus' }],
        }),
      ],
    }),
  })
const calls = (player: unknown) => vi.mocked(player as typeof Player).mock.calls
const lastProps = (player: unknown): any => calls(player).at(-1)![0]
/** The player's root element: only the scene player carries `data-scene-ready`. */
const region = () => screen.getByRole('region', { name: 'Animation player' })
const isScene = () => region().hasAttribute('data-scene-ready')

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  pane.items = []
  pane.announcement = ''
})
afterEach(() => {
  cleanup()
  mocks.visualProps.length = 0
  vi.clearAllMocks()
})

describe('which player the Illustrate pane mounts for an animated visual', () => {
  it('keeps the step player for graphs while sceneAnimations is off (the default)', () => {
    flags({ animations: true, sceneAnimations: false })
    render(<RecordView record={make.visualRecord()} />)
    expect(isScene()).toBe(false)
    expect(calls(Player).length).toBeGreaterThan(0)
    expect(calls(ScenePlayer)).toHaveLength(0)
    // The step player draws each frame itself.
    expect(screen.getByTestId('visual').getAttribute('data-frame')).toBe('0')
  })

  it('mounts the scene player for a graph with several frames when both flags are on', () => {
    flags({ animations: true, sceneAnimations: true })
    const record = make.visualRecord()
    render(<RecordView record={record} />)
    expect(isScene()).toBe(true)
    expect(calls(Player)).toHaveLength(0)
    const props = lastProps(ScenePlayer)
    expect(props.ir).toMatchObject({ type: 'graph' })
    expect(props.frames).toHaveLength(3)
    expect(props.autoPlay).toBe(true)
    // renderScene() is the complete static visual, not a frame.
    expect(screen.getByTestId('visual').getAttribute('data-frame')).toBe(
      'static',
    )
    expect(mocks.visualProps.every((p) => p.frame === undefined)).toBe(true)
  })

  it('needs the animations flag as well: sceneAnimations alone draws the static visual', () => {
    flags({ animations: false, sceneAnimations: true })
    render(<RecordView record={make.visualRecord()} />)
    expect(calls(ScenePlayer)).toHaveLength(0)
    expect(calls(Player)).toHaveLength(0)
    expect(screen.getByTestId('visual').getAttribute('data-frame')).toBe(
      'static',
    )
  })

  it('keeps the step player for non-graph visuals even with sceneAnimations on', () => {
    flags({ animations: true, sceneAnimations: true })
    render(<RecordView record={sequence()} />)
    expect(isScene()).toBe(false)
    expect(calls(Player).length).toBeGreaterThan(0)
    expect(calls(ScenePlayer)).toHaveLength(0)
  })

  it('does not mount the scene player for a graph without frames or with a single frame', async () => {
    flags({ animations: true, sceneAnimations: true })
    const { buildFrames: spy } = await import('@illus/core')
    // No animation: no frames at all.
    const { unmount } = render(
      <RecordView record={make.visualRecord({ animation: undefined })} />,
    )
    expect(calls(ScenePlayer)).toHaveLength(0)
    expect(calls(Player)).toHaveLength(0)
    expect(screen.getByTestId('visual').getAttribute('data-frame')).toBe(
      'static',
    )
    unmount()
    // A lone base frame has nothing to play.
    const record = make.visualRecord()
    const [base] = buildFrames(record.ir as any, record.animation!)
    vi.mocked(spy).mockReturnValueOnce([base!])
    render(<RecordView record={record} />)
    expect(calls(ScenePlayer)).toHaveLength(0)
    expect(calls(Player).length).toBeGreaterThan(0)
  })
})

describe('what the scene player is given', () => {
  it('passes the remembered highlight option, speed and reduced motion, and saves a changed option', () => {
    flags({ animations: true, sceneAnimations: true })
    pane.preferences.highlightSteps = false
    pane.preferences.speed = 1.5
    pane.preferences.reducedMotion = 'on'
    render(<RecordView record={make.visualRecord()} />)
    const props = lastProps(ScenePlayer)
    expect(props).toMatchObject({
      highlightWhilePlaying: false,
      defaultSpeed: 1.5,
      reducedMotion: true,
    })
    const box = screen.getByLabelText(
      'Highlight passage while playing',
    ) as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ highlightSteps: true }),
    )
    // Controlled: the box follows the saved preference, not the click.
    expect(box.checked).toBe(false)
  })

  it('leaves reduced motion to the system when the setting says so', () => {
    flags({ animations: true, sceneAnimations: true })
    pane.preferences.reducedMotion = 'system'
    render(<RecordView record={make.visualRecord()} />)
    expect(lastProps(ScenePlayer).reducedMotion).toBeUndefined()
    cleanup()
    pane.preferences.reducedMotion = 'off'
    render(<RecordView record={make.visualRecord()} />)
    expect(lastProps(ScenePlayer).reducedMotion).toBe(false)
  })

  it('announces the step narration and sends clicked narration evidence to the book as a step highlight', () => {
    flags({ animations: true, sceneAnimations: true })
    render(<RecordView record={make.visualRecord()} />)
    const { frames } = lastProps(ScenePlayer)
    // Step 0 is the base frame: nothing to say.
    expect(pane.announcement).toBe(frames[0].narration ?? '')
    lastProps(ScenePlayer).onStepChange(1)
    expect(pane.announcement).toBe(frames[1].narration)
    lastProps(ScenePlayer).onEvidenceClick(frames[1].evidence)
    expect(highlightEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'step',
        evidence: frames[1].evidence,
      }),
      true,
      'step',
    )
  })

  it('sends the current step passage to the book through onEvidenceHighlight', () => {
    flags({ animations: true, sceneAnimations: true })
    render(<RecordView record={make.visualRecord()} />)
    const { onEvidenceHighlight } = lastProps(ScenePlayer)
    onEvidenceHighlight(null)
    expect(highlightEvidence).toHaveBeenLastCalledWith(null, false, 'step')
  })
})

describe('the scene player gets stable ir, frames and renderScene', () => {
  const rerenderWith = (
    view: ReturnType<typeof render>,
    record: VisualRecord,
  ) => view.rerender(<RecordView record={record} />)

  it('keeps all three across re-renders and preference saves that change nothing visible', () => {
    flags({ animations: true, sceneAnimations: true })
    const record = make.visualRecord()
    const view = render(<RecordView record={record} />)
    const first = lastProps(ScenePlayer)
    const rendered = calls(ScenePlayer).length

    rerenderWith(view, record)
    // savePreferences replaces the whole flags object even when no flag changed.
    pane.preferences = {
      ...pane.preferences,
      highlightSteps: false,
      flags: resolveFlags({ animations: true, sceneAnimations: true }),
    }
    rerenderWith(view, record)
    expect(calls(ScenePlayer).length).toBeGreaterThan(rendered)
    // Nothing the scene shows changed, so it is not drawn again (a new flags object alone is not a change).
    expect(lastProps(ScenePlayer).renderScene).toBe(first.renderScene)
    // A different object for the same stored visual (a fresh snapshot of the same data).
    rerenderWith(view, structuredClone(record))
    const last = lastProps(ScenePlayer)
    expect(last.ir).toBe(first.ir)
    expect(last.frames).toBe(first.frames)
    expect(last.onStepChange).toBe(first.onStepChange)
    expect(last.onEvidenceClick).toBe(first.onEvidenceClick)
    expect(last.onEvidenceHighlight).toBe(first.onEvidenceHighlight)
    expect(last.onHighlightWhilePlayingChange).toBe(
      first.onHighlightWhilePlayingChange,
    )
    // The option that did change reaches the player.
    expect(first.highlightWhilePlaying).toBe(true)
    expect(last.highlightWhilePlaying).toBe(false)
  })

  it('keeps renderScene when only the unrelated pane state changes', () => {
    flags({ animations: true, sceneAnimations: true })
    const record = make.visualRecord()
    const view = render(<RecordView record={record} />)
    const first = lastProps(ScenePlayer).renderScene
    const visuals = mocks.visualProps.length
    act(() => {
      pane.announcement = 'something else'
      pane.message = 'another thing'
    })
    rerenderWith(view, record)
    expect(lastProps(ScenePlayer).renderScene).toBe(first)
    // The scene itself was not drawn again.
    expect(mocks.visualProps.length).toBe(visuals)
  })

  it('draws the scene again only when what it shows changes, with the same ir and frames', () => {
    flags({ animations: true, sceneAnimations: true })
    const record = make.visualRecord()
    const view = render(<RecordView record={record} />)
    const first = lastProps(ScenePlayer)
    // A vote is part of the scene's chrome, so renderScene changes; the animation is untouched.
    rerenderWith(view, { ...record, feedback: { vote: 'up' } })
    const voted = lastProps(ScenePlayer)
    expect(voted.renderScene).not.toBe(first.renderScene)
    expect(voted.ir).toBe(first.ir)
    expect(voted.frames).toBe(first.frames)
    expect(mocks.visualProps.at(-1).actions.vote).toBe('up')
  })

  it('rebuilds frames only when the animation changes', () => {
    flags({ animations: true, sceneAnimations: true })
    const record = make.visualRecord()
    const view = render(<RecordView record={record} />)
    const first = lastProps(ScenePlayer)
    rerenderWith(
      view,
      make.visualRecord({
        animation: make.animationIR({
          steps: [
            make.step(),
            make.step({
              id: 's2',
              narration: 'A different second step.',
              actions: [
                { op: 'reveal', target: 'node:follower' },
                { op: 'reveal', target: 'edge:e3' },
              ],
            }),
          ],
        }),
      }),
    )
    const next = lastProps(ScenePlayer)
    expect(next.frames).not.toBe(first.frames)
    expect(next.ir).toBe(first.ir)
  })
})

describe('the large view', () => {
  it('keeps the same scene player (and its DOM) when the visual is expanded and collapsed', () => {
    flags({ animations: true, sceneAnimations: true })
    const view = render(<RecordView record={make.visualRecord()} />)
    const root = region()
    const before = lastProps(ScenePlayer)
    const record = () => view.container.querySelector('.illus-record')!
    expect(record().hasAttribute('data-expanded')).toBe(false)
    expect(
      screen.getByTestId('visual').getAttribute('data-expanded-prop'),
    ).toBe('false')

    fireEvent.click(screen.getByText('Expand visual'))
    expect(record().getAttribute('data-expanded')).toBe('true')
    expect(record().getAttribute('role')).toBe('dialog')
    // Same element, same player: only the scene's own chrome is drawn again.
    expect(region()).toBe(root)
    expect(isScene()).toBe(true)
    expect(
      screen.getByTestId('visual').getAttribute('data-expanded-prop'),
    ).toBe('true')
    const expanded = lastProps(ScenePlayer)
    expect(expanded.renderScene).not.toBe(before.renderScene)
    expect(expanded.frames).toBe(before.frames)
    expect(expanded.ir).toBe(before.ir)
    expect(calls(Player)).toHaveLength(0)

    // Escape closes the large view only.
    fireEvent.keyDown(region(), { key: 'Escape' })
    expect(record().hasAttribute('data-expanded')).toBe(false)
    expect(region()).toBe(root)
    expect(
      screen.getByTestId('visual').getAttribute('data-expanded-prop'),
    ).toBe('false')
  })
})
