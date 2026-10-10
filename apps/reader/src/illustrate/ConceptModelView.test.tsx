// @vitest-environment jsdom
import type { PatchOp } from '@illus/core'
import { make, Q } from '@illus/core/testing'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConceptModelView } from './ConceptModelView'

afterEach(cleanup)
const node = (id: string): PatchOp => ({
  op: 'addNode',
  node: { id, label: id, shape: 'box', evidence: Q.request },
})
const patch = (ord: number, ops: PatchOp[]) =>
  make.patch({
    patchId: `m@${ord}`,
    sectionId: `s${ord}`,
    sectionOrdinal: ord,
    ops,
  })
const model = make.conceptModel({
  patches: [patch(1, [node('a'), node('b')]), patch(2, [node('c')])],
})

describe('<ConceptModelView />', () => {
  it('draws the section view from the model, with toggles and the evolution scrubber', () => {
    const draws: { ids: string[]; newIds: string[]; persist: boolean }[] = []
    const baseLayout = vi.fn()
    const draw = vi.fn((view, _frame, _layout, onLayout) => {
      const ids =
        view.ir.type === 'graph'
          ? view.ir.nodes.map((n: { id: string }) => n.id)
          : []
      draws.push({ ids, newIds: view.newIds, persist: !!onLayout })
      return (
        <p data-testid="drawn">
          {ids.join(',')}|{view.newIds.join(',')}
        </p>
      )
    })
    render(
      <ConceptModelView
        model={model}
        sectionOrdinal={2}
        sectionTitles={{ s1: 'Roles', s2: 'Terms' }}
        baseLayout={baseLayout}
        onLayout={vi.fn()}
        draw={draw}
        playerProps={{ reducedMotion: true }}
      />,
    )
    expect(screen.getByTestId('drawn').textContent).toBe('a,b,c|c')
    expect(draws.at(-1)!.persist).toBe(true)
    // "Only this section's additions" draws a subset and never persists its layout.
    fireEvent.click(screen.getByLabelText("Only this section's additions"))
    expect(screen.getByTestId('drawn').textContent).toBe('c|c')
    expect(draws.at(-1)!.persist).toBe(false)
    // The scrubber mounts on demand and replays one frame per patch.
    const details = screen.getByText('How this model grew').closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(screen.getByRole('slider')).toBeDefined()
    expect(screen.getAllByTestId('drawn').length).toBe(2)
  })
})
