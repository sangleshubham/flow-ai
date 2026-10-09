// Zod → JSON Schema for OpenAI structured outputs in strict mode (§9, ADR 0003 follow-up).
// Strict mode needs every property required and `additionalProperties: false`, so optional properties
// become required-and-nullable; the model's nulls for them are stripped again before the Zod parse.
// Keywords strict mode does not document (minLength, maxLength, format, …) are dropped; the server-side
// Zod parse still enforces them (§9 step 7).
import { z } from 'zod'

import { SCHEMAS } from '@illus/core'
import type { SchemaName, TemplateId, TemplateRegistry } from '@illus/core'
import { TemplateIR } from '@illus/core'

export type JsonSchema = { [key: string]: unknown }

const KEEP = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'anyOf',
  'enum',
  'const',
  'description',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
])

export interface OutputSchema {
  /** The Zod schema the server parses the output with. */
  zod: z.ZodType
  /** Plain `z.toJSONSchema` output, used to strip the nulls added for optional properties. */
  original: JsonSchema
  /** Strict-mode schema sent as `text.format.schema` (or as the fallback tool's parameters). */
  strict: JsonSchema
  /** False when part of the schema cannot be expressed strictly (an open `unknown`); sent with `strict: false`. */
  isStrict: boolean
}

/**
 * The output schema for a request. `TemplateIR` is composed with the template's own props schema when a
 * registry is available (ADR 0003 item 3); without one, `props` stays open and the schema is non-strict.
 */
export function outputSchema(name: SchemaName, opts: { templateId?: TemplateId | undefined; templates?: TemplateRegistry | undefined } = {}): OutputSchema {
  let zod: z.ZodType = SCHEMAS[name]
  if (name === 'TemplateIR' && opts.templateId && opts.templates) {
    const spec = opts.templates.getTemplate(opts.templateId)
    if (spec) zod = TemplateIR.extend({ templateId: z.literal(spec.id), props: spec.propsSchema })
  }
  const original = z.toJSONSchema(zod, { unrepresentable: 'any' }) as JsonSchema
  const state = { isStrict: true }
  const strict = toStrict(original, state)
  return { zod, original, strict, isStrict: state.isStrict }
}

function toStrict(s: JsonSchema, state: { isStrict: boolean }): JsonSchema {
  const out: JsonSchema = {}
  const src: JsonSchema = { ...s }
  if (Array.isArray(src.oneOf)) {
    src.anyOf = src.oneOf
    delete src.oneOf
  }
  if (Array.isArray(src.prefixItems)) {
    // Homogeneous tuples ([number, number]) become fixed-length arrays; Zod re-checks the tuple.
    const items = src.prefixItems as JsonSchema[]
    const first = JSON.stringify(items[0])
    if (!items.every((i) => JSON.stringify(i) === first)) state.isStrict = false
    src.items = items[0]
    src.minItems = items.length
    src.maxItems = items.length
    delete src.prefixItems
  }
  for (const [k, v] of Object.entries(src)) {
    if (!KEEP.has(k)) continue
    if (k === 'properties') {
      const props = v as Record<string, JsonSchema>
      const required = new Set((src.required as string[] | undefined) ?? [])
      out.properties = Object.fromEntries(
        Object.entries(props).map(([name, p]) => {
          const sp = toStrict(p, state)
          return [name, required.has(name) || allowsNull(p) ? sp : { anyOf: [sp, { type: 'null' }] }]
        }),
      )
      out.required = Object.keys(props)
      out.additionalProperties = false
    } else if (k === 'items' && v && typeof v === 'object') out.items = toStrict(v as JsonSchema, state)
    else if (k === 'anyOf') out.anyOf = (v as JsonSchema[]).map((b) => toStrict(b, state))
    else if (k === 'required' || k === 'additionalProperties') continue // set with `properties`
    else out[k] = v
  }
  if (src.type === 'object' && !out.properties) {
    out.properties = {}
    out.required = []
    out.additionalProperties = false
  }
  if (!('type' in out) && !('anyOf' in out) && !('enum' in out) && !('const' in out)) state.isStrict = false
  return out
}

function allowsNull(s: JsonSchema): boolean {
  if (s.type === 'null' || s.const === null) return true
  if (Array.isArray(s.type) && s.type.includes('null')) return true
  if (Array.isArray(s.enum) && s.enum.includes(null)) return true
  const branches = (s.anyOf ?? s.oneOf) as JsonSchema[] | undefined
  return !!branches?.some(allowsNull)
}

/**
 * Removes `null` values the strict schema allowed only because the property is optional, so Zod sees
 * `undefined` again. Nulls that the original schema allows (e.g. `pointer.target`) are kept.
 */
export function stripAddedNulls(value: unknown, schema: JsonSchema): unknown {
  if (Array.isArray(value)) {
    const items = schema.items && typeof schema.items === 'object' ? (schema.items as JsonSchema) : undefined
    const prefix = schema.prefixItems as JsonSchema[] | undefined
    return value.map((v, i) => {
      const s = prefix?.[i] ?? items
      return s ? stripAddedNulls(v, s) : v
    })
  }
  if (!value || typeof value !== 'object') return value
  const branches = (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined
  if (branches) {
    const objectBranches = branches.filter((b) => b.properties)
    const matching = objectBranches.filter((b) => constsMatch(b, value as Record<string, unknown>))
    return (matching.length ? matching : objectBranches).reduce<unknown>((v, b) => stripAddedNulls(v, b), value)
  }
  const props = schema.properties as Record<string, JsonSchema> | undefined
  if (!props) return value
  const required = new Set((schema.required as string[] | undefined) ?? [])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    const p = props[k]
    if (v === null && p && !required.has(k) && !allowsNull(p)) continue
    out[k] = p ? stripAddedNulls(v, p) : v
  }
  return out
}

function constsMatch(branch: JsonSchema, value: Record<string, unknown>): boolean {
  const props = branch.properties as Record<string, JsonSchema>
  const consts = Object.entries(props).filter(([, p]) => 'const' in p)
  return consts.length > 0 && consts.every(([k, p]) => value[k] === p.const)
}
