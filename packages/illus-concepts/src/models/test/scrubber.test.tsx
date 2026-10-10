// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { PatchOp } from '@illus/core'
import { Q, make } from '@illus/core/testing'

import { Player } from '@illus/anim'

import { ConceptViewToggles, EvolutionScrubber, evolutionFrames } from '../scrubber.ts'
import type { SectionView } from '../view.ts'

afterEach(cleanup)

const node = (id: string): PatchOp => ({ op: 'addNode', node: { id, label: id, shape: 'box', evidence: Q.request } })
const patch = (ord: number, ops: PatchOp[], extra: object = {}) => make.patch({ patchId: `m@${ord}`, sectionId: `s${ord}`, sectionOrdinal: ord, ops, ...extra })
const model = make.conceptModel({
  patches: [patch(1, [node('a'), node('b')]), patch(2, [node('x')], { stale: true }), patch(3, [node('c'), { op: 'remove', id: 'b', evidence: Q.reply }]), patch(5, [node('d')])],
})

describe('evolutionFrames', () => {
  it('has one frame per non-stale patch boundary up to the section', () => {
    const { frames, views } = evolutionFrames(model, 3, { sectionTitles: { s1: '6.1 Roles' } })
    expect(frames.map((f) => [f.step, f.stepId])).toEqual([[0, 'm@1'], [1, 'm@3']])
    expect(frames[0]!.narration).toBe('6.1 Roles: 2 added')
    expect(frames[1]!.narration).toBe('Section 2: 1 added, 1 removed')
    expect(frames[1]!.removed).toEqual(['node:b'])
    expect(frames[0]!.evidence).toEqual(Q.request)
    expect(views.map((v) => v.newIds)).toEqual([['a', 'b'], ['c']])
  })
})

describe('<EvolutionScrubber />', () => {
  it('plays patch boundaries with the §11 player', () => {
    const seen: string[] = []
    const renderView = (v: SectionView) => {
      seen.push(v.newIds.join(','))
      return <div data-testid="view">{v.newIds.join(',')}</div>
    }
    render(<EvolutionScrubber Player={Player} model={model} sectionOrdinal={5} renderView={renderView} reducedMotion />)
    expect(screen.getByTestId('view').textContent).toBe('a,b')
    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider.max).toBe('2')
    fireEvent.change(slider, { target: { value: '2' } })
    expect(screen.getByTestId('view').textContent).toBe('d')
  })

  it('renders nothing without patches', () => {
    const { container } = render(<EvolutionScrubber Player={Player} model={make.conceptModel({ patches: [] })} sectionOrdinal={9} renderView={() => null} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('<ConceptViewToggles />', () => {
  it('reports both toggles', () => {
    let value = {}
    render(<ConceptViewToggles value={{}} onChange={(v) => (value = v)} />)
    fireEvent.click(screen.getByLabelText("Only this section's additions"))
    expect(value).toEqual({ onlyNew: true })
    fireEvent.click(screen.getByLabelText('Show full model'))
    expect(value).toEqual({ fullModel: true })
  })
})
