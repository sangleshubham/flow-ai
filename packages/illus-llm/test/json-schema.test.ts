import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { SCHEMAS, SchemaName } from '@illus/core'
import type { TemplateRegistry, TemplateSpec } from '@illus/core'

import { outputSchema, stripAddedNulls } from '../src/index.ts'
import type { JsonSchema } from '../src/index.ts'
import { SAMPLE } from './helpers.ts'

const ALLOWED_KEYS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'anyOf', 'enum', 'const', 'description',
  'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems',
])

/** Asserts the OpenAI strict-mode shape everywhere in a schema. */
function assertStrict(s: JsonSchema, path = '$'): void {
  for (const k of Object.keys(s)) expect(ALLOWED_KEYS, `${path} has ${k}`).toContain(k)
  if (s.properties) {
    expect(s.additionalProperties, path).toBe(false)
    expect(s.required, path).toEqual(Object.keys(s.properties as object))
    for (const [k, p] of Object.entries(s.properties as Record<string, JsonSchema>)) assertStrict(p, `${path}.${k}`)
  }
  if (s.items && typeof s.items === 'object') assertStrict(s.items as JsonSchema, `${path}[]`)
  for (const b of (s.anyOf as JsonSchema[] | undefined) ?? []) assertStrict(b, `${path}|`)
}

/** What a strict-mode model sends: every optional property present, as null when unused. */
function fillNulls(value: unknown, s: JsonSchema): unknown {
  if (Array.isArray(value)) return value.map((v) => fillNulls(v, (s.items as JsonSchema) ?? {}))
  if (!value || typeof value !== 'object') return value
  const branches = s.anyOf as JsonSchema[] | undefined
  if (branches) {
    const v = value as Record<string, unknown>
    const fits = (b: JsonSchema) => {
      const props = b.properties as Record<string, JsonSchema> | undefined
      return !!props && Object.keys(v).every((k) => k in props) && Object.entries(props).every(([k, p]) => !('const' in p) || v[k] === p.const)
    }
    const b = branches.find(fits)
    return b ? fillNulls(value, b) : value
  }
  if (!s.properties || Object.keys(s.properties).length === 0) return value
  const props = s.properties as Record<string, JsonSchema>
  return Object.fromEntries(Object.keys(props).map((k) => [k, k in value ? fillNulls((value as Record<string, unknown>)[k], unwrap(props[k]!)) : null]))
}
const unwrap = (p: JsonSchema): JsonSchema => {
  const b = p.anyOf as JsonSchema[] | undefined
  return b && b.length === 2 && (b[1] as JsonSchema).type === 'null' ? (b[0] as JsonSchema) : p
}

describe('outputSchema (strict-mode adaptation, ADR 0003)', () => {
  it.each(SchemaName.options.filter((n) => n !== 'TemplateIR'))('%s is a strict object schema', (name) => {
    const s = outputSchema(name)
    expect(s.isStrict).toBe(true)
    expect(s.strict.type).toBe('object')
    assertStrict(s.strict)
  })

  it.each(SchemaName.options)('%s: model output with nulls for optionals parses after stripping', (name) => {
    const s = outputSchema(name)
    const sample = SAMPLE[name]()
    const fromModel = JSON.parse(JSON.stringify(fillNulls(sample, s.strict)))
    expect(SCHEMAS[name].parse(stripAddedNulls(fromModel, s.original))).toEqual(SCHEMAS[name].parse(sample))
  })

  it('turns homogeneous tuples into fixed-length arrays (ChartIR domain)', () => {
    const domain = (outputSchema('ChartIR').strict.properties as Record<string, JsonSchema>).domain!
    expect(domain).toEqual({ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 })
  })

  it('keeps nulls the original schema allows (pointer target)', () => {
    const s = outputSchema('AnimationIR')
    const anim = SAMPLE.AnimationIR() as { steps: { actions: unknown[] }[] }
    anim.steps[0]!.actions = [{ op: 'pointer', name: 'p', target: null }]
    const stripped = stripAddedNulls(anim, s.original) as typeof anim
    expect(stripped.steps[0]!.actions[0]).toEqual({ op: 'pointer', name: 'p', target: null })
  })

  it('TemplateIR is non-strict without a registry and strict with the template props schema', () => {
    expect(outputSchema('TemplateIR').isStrict).toBe(false)
    const sample = SAMPLE.TemplateIR() as { templateId: string; props: unknown }
    const spec = {
      id: sample.templateId,
      propsSchema: z.object({ values: z.array(z.number()), label: z.string().optional() }),
    } as unknown as TemplateSpec
    const templates: TemplateRegistry = { getTemplate: (id) => (id === spec.id ? spec : undefined), listTemplates: () => [spec] }
    const s = outputSchema('TemplateIR', { templateId: spec.id, templates })
    expect(s.isStrict).toBe(true)
    assertStrict(s.strict)
    expect(s.zod.safeParse({ ...sample, props: { values: [1, 2] } }).success).toBe(true)
    expect(s.zod.safeParse({ ...sample, props: { values: 'x' } }).success).toBe(false)
  })
})

describe('length limits the strict schema cannot carry', () => {
  const find = (s: JsonSchema, path: string[]): JsonSchema => {
    let cur = s
    for (const k of path) {
      if (k === '[]') cur = cur.items as JsonSchema
      else cur = (cur.properties as Record<string, JsonSchema>)[k]!
      const nonNull = (cur.anyOf as JsonSchema[] | undefined)?.find((b) => b.type !== 'null')
      if (nonNull) cur = nonNull
    }
    return cur
  }

  it('states maxLength in the description so the model sees it', () => {
    const { strict } = outputSchema('GraphIR')
    expect(find(strict, ['nodes', '[]', 'label']).description).toMatch(/at most 40 characters/i)
    expect(find(strict, ['nodes', '[]', 'sublabel']).description).toMatch(/at most 40 characters/i)
  })

  it('states word limits in the description', () => {
    const { strict } = outputSchema('VisualPlan')
    expect(find(strict, ['items', '[]', 'intent']).description).toMatch(/at most 25 words/i)
  })
})
