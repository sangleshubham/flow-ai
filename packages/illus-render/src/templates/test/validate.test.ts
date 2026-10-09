// The registry plugs into W10's validate() (§16 L3 "Template" rule): props and invariants are checked.
import { describe, expect, it } from 'vitest'

import { ground, validate } from '@illus/core'
import type { Block, TemplateIR } from '@illus/core'
import { make } from '@illus/core/testing'

import { exampleIR, getTemplate, listTemplates, templateRegistry } from '../index.ts'

/** One block per example quote, so every example element is grounded. */
function ctxFor(ir: TemplateIR) {
  const blocks = new Map<string, Block>()
  for (const e of ir.evidence) {
    const prev = blocks.get(e.evidence.blockId)
    blocks.set(e.evidence.blockId, make.block({ blockId: e.evidence.blockId, text: `${prev ? `${prev.text} ` : ''}${e.evidence.quote}.` }))
  }
  return { blocks, ground, templates: templateRegistry }
}

describe('validate() with the template registry', () => {
  it.each(listTemplates().map((t) => [t.id, t] as const))('%s example has no template errors', (_, t) => {
    const ir = exampleIR(t)
    const { report } = validate('template', ir, ctxFor(ir))
    expect(report.issues.filter((i) => i.code.startsWith('template-'))).toEqual([])
  })

  it('reports invariant violations from the template', () => {
    const ir: TemplateIR = { ...exampleIR(getTemplate('tree')!), props: { variant: 'bst', nodes: [{ id: 'r', keys: [5] }, { id: 'l', keys: [9], parent: 'r', side: 'left' }] } }
    const { report } = validate('template', ir, ctxFor(ir))
    expect(report.ok).toBe(false)
    expect(report.issues.find((i) => i.code === 'template-invariant')?.message).toMatch(/BST order broken at l/)
  })

  it('reports props that break the template schema', () => {
    const ir: TemplateIR = { ...exampleIR(getTemplate('array')!), props: { values: Array.from({ length: 17 }, (_, i) => i) } }
    const { report } = validate('template', ir, ctxFor(ir))
    expect(report.issues.some((i) => i.code === 'template-props')).toBe(true)
  })
})
