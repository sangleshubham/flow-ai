// Registry docs, schema round-trips and strict-mode compatibility for every template (§8 stage 2, §10).
import { describe, expect, it } from 'vitest'

import { ACTION_OPS, Target, TemplateEvidence, TemplateId, TemplateIR } from '@illus/core'

import { exampleIR, getTemplate, listTemplates, templateDoc, templateJsonSchema, templateRegistry } from '../index.ts'

type Json = Record<string, unknown>

/** Walks a JSON Schema and reports what OpenAI strict mode (via @illus/llm's adapter) cannot express. */
function strictProblems(s: Json, at = '#'): string[] {
  const out: string[] = []
  if ('$ref' in s || '$defs' in s) out.push(`${at}: uses $ref/$defs`)
  if (s.type === 'object') {
    if (!s.properties) out.push(`${at}: object without fixed properties (a record)`)
    if (s.additionalProperties && typeof s.additionalProperties === 'object') out.push(`${at}: open additionalProperties`)
  }
  if (!('type' in s) && !('anyOf' in s) && !('oneOf' in s) && !('enum' in s) && !('const' in s)) out.push(`${at}: untyped`)
  for (const [k, v] of Object.entries((s.properties as Record<string, Json> | undefined) ?? {})) out.push(...strictProblems(v, `${at}/${k}`))
  if (s.items && typeof s.items === 'object') out.push(...strictProblems(s.items as Json, `${at}/items`))
  for (const b of ((s.anyOf ?? s.oneOf) as Json[] | undefined) ?? []) out.push(...strictProblems(b, `${at}/anyOf`))
  return out
}

describe('registry', () => {
  it('holds exactly the 16 templates of §10, in table order', () => {
    expect(listTemplates().map((t) => t.id)).toEqual(TemplateId.options)
    for (const id of TemplateId.options) expect(templateRegistry.getTemplate(id)?.id).toBe(id)
    expect(getTemplate('nope' as TemplateId)).toBeUndefined()
  })
})

describe.each(listTemplates().map((t) => [t.id, t] as const))('%s', (_, t) => {
  it('has short prompt docs', () => {
    for (const s of [t.description, t.whenToUse, t.evidencePaths, t.targetsDoc]) {
      expect(s.length).toBeGreaterThan(20)
      expect(s.length).toBeLessThan(420)
    }
    const doc = templateDoc(t.id)
    expect(doc).toContain(t.description)
    expect(doc).toContain('"$schema"')
    expect(doc).toContain(`"templateId": "${t.id}"`)
  })

  it('example is valid, invariant-clean and survives a JSON round trip', () => {
    const parsed = t.propsSchema.parse(JSON.parse(JSON.stringify(t.example)))
    expect(parsed).toEqual(t.example)
    expect(t.checkInvariants?.(parsed)).toEqual([])
    const ir = TemplateIR.parse(JSON.parse(JSON.stringify(exampleIR(t))))
    expect(ir.templateId).toBe(t.id)
  })

  it('example evidence is well formed and addresses real props', () => {
    expect(t.exampleEvidence.length).toBeGreaterThan(0)
    for (const e of t.exampleEvidence) {
      TemplateEvidence.parse(e)
      let cur: unknown = t.example
      for (const seg of e.path.split('.')) {
        expect(cur, e.path).toBeTypeOf('object')
        cur = (cur as Record<string, unknown>)[seg]
        expect(cur, e.path).toBeDefined()
      }
    }
  })

  it('props schema converts to JSON Schema that strict structured outputs accept', () => {
    const js = templateJsonSchema(t)
    expect(js.type).toBe('object')
    expect(strictProblems(js)).toEqual([])
  })

  it('targets are §11 targets and actions are known ops', () => {
    for (const target of t.targets(t.example)) Target.parse(target)
    for (const op of t.supportedActions) expect(ACTION_OPS).toContain(op)
    const seed = t.initialFrame?.(t.example)
    for (const target of Object.values(seed?.pointers ?? {})) Target.parse(target)
  })

  it('layout is deterministic and finite', () => {
    if (t.id === 'graph-ds') {
      expect(t.layout(t.example)).toEqual(t.layout(t.example))
      return
    }
    const a = t.layout(t.example) as { width: number; height: number }
    expect(JSON.stringify(t.layout(t.example))).toEqual(JSON.stringify(a))
    expect(Number.isFinite(a.width) && a.width > 0 && a.width < 1400).toBe(true)
    expect(Number.isFinite(a.height) && a.height > 0 && a.height < 1400).toBe(true)
  })
})
