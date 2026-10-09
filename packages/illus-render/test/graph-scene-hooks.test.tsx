// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { LayoutGraphResult } from '@illus/core'
import { make, Q } from '@illus/core/testing'

import { GraphView } from '../src/graph/GraphView.tsx'

afterEach(cleanup)

it('exposes scene geometry and animation bodies without taking ownership of scene transforms or overlay children', () => {
  const ir = make.graphIR({
    nodes: [
      { id: 'a', label: 'A', shape: 'box', group: 'g', evidence: Q.request },
    ],
    groups: [{ id: 'g', label: 'Group', evidence: Q.request }],
    edges: [],
  })
  const layout: LayoutGraphResult = {
    width: 200.25,
    height: 160.75,
    nodes: {
      a: { x: 30.14, y: 40.26, width: 80.38, height: 40.42 },
      g: { x: 10.14, y: 20.26, width: 120.38, height: 100.42 },
    },
    edges: {
      'a->b': {
        points: [
          { x: 30, y: 40 },
          { x: 100, y: 80 },
        ],
      },
    },
  }
  const layoutGraph = vi.fn()
  const props = {
    ir,
    theme: make.themeTokens(),
    layout,
    layoutGraph,
    onReady: vi.fn(),
    onError: vi.fn(),
  }
  const { container, rerender } = render(<GraphView {...props} />)
  const svg = container.querySelector('svg.illus-graph')!
  const camera = svg.querySelector(':scope > [data-camera]')!
  expect(svg.getAttribute('data-layout')).toBe('200.25 160.75')
  expect(camera.hasAttribute('transform')).toBe(false)
  const node = camera.querySelector('[data-target="node:a"]')!
  expect(node.getAttribute('transform')).toBe('translate(30.14, 40.26)')
  expect(node.getAttribute('data-box')).toBe('30.1 40.3 80.4 40.4')
  expect(
    node.querySelector(
      ':scope > .illus-node-body[data-anim-body] > .illus-shape',
    ),
  ).not.toBeNull()
  const group = camera.querySelector('[data-target="group:g"]')!
  expect(group.getAttribute('data-box')).toBe('10.1 20.3 120.4 100.4')
  expect(
    group.querySelector(
      ':scope > .illus-group-body[data-anim-body] > .illus-group-box',
    ),
  ).not.toBeNull()
  const edge = camera.querySelector('[data-target="edge:a->b"]')!
  expect(
    edge.querySelector(':scope > [data-anim-body] > .illus-edge-line'),
  ).not.toBeNull()
  // The existing Player still discovers paths through the new body wrapper.
  expect(edge.querySelector('path,line')).toBe(
    edge.querySelector('.illus-edge-line'),
  )
  const overlay = camera.lastElementChild!
  expect(overlay.hasAttribute('data-scene-overlay')).toBe(true)
  expect(overlay.childElementCount).toBe(0)
  camera.setAttribute('transform', 'scale(2)')
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  overlay.append(dot)
  rerender(<GraphView {...props} ir={{ ...ir, title: 'Updated title' }} />)
  expect(camera.getAttribute('transform')).toBe('scale(2)')
  expect(overlay.firstElementChild).toBe(dot)
  expect(node.getAttribute('transform')).toBe('translate(30.14, 40.26)')
  expect(layoutGraph).not.toHaveBeenCalled()
})
