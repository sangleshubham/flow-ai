import type { TraceStep, Translation, ValueRef, TemplateId } from '@illus/core'
type Hint = Translation['vizHints'][number]
export interface TraceProjection {
  templateId: TemplateId
  props: Record<string, unknown>
  clipped: boolean
}
const cell = (v?: ValueRef): string | number | null =>
  !v
    ? null
    : 'prim' in v
    ? typeof v.prim === 'boolean'
      ? String(v.prim)
      : v.prim
    : `@${v.ref}`

/** Pure projections over recorded snapshots. Never fabricates values or evaluates the Python. */
export function projectHint(
  step: TraceStep,
  hint: Hint,
  hints: readonly Hint[] = [],
): TraceProjection | undefined {
  const frame = [...step.frames]
    .reverse()
    .find((f) => (!hint.fn || hint.fn === f.fn) && f.locals[hint.variable])
  const value = frame?.locals[hint.variable]
  if (!frame || !value || !('ref' in value)) return undefined
  const obj = step.heap[value.ref]
  if (!obj) return undefined
  const pointers = hints.filter(
    (h) => h.pointerOf === hint.variable && (!h.fn || h.fn === frame.fn),
  )
  if (hint.template === 'array' && obj.items?.length) {
    return {
      templateId: 'array',
      clipped: obj.items.length > 16 || !!obj.truncated,
      props: {
        label: hint.variable,
        values: obj.items.slice(0, 16).map((v) => cell(v) ?? 'None'),
        pointers: pointers
          .flatMap((h) => {
            const v = frame.locals[h.variable]
            return v &&
              'prim' in v &&
              typeof v.prim === 'number' &&
              Number.isInteger(v.prim) &&
              v.prim >= -1 &&
              v.prim <= Math.min(obj.items!.length, 16)
              ? [{ name: h.variable.slice(0, 20), index: v.prim }]
              : []
          })
          .slice(0, 6),
      },
    }
  }
  if (hint.template === 'grid' && obj.items?.length) {
    const rows = obj.items
      .slice(0, 12)
      .map((v) =>
        'ref' in v
          ? step.heap[v.ref]?.items?.slice(0, 12).map(cell)
          : undefined,
      )
    if (
      rows.some((r) => !r?.length) ||
      rows.some((r) => r!.length !== rows[0]!.length)
    )
      return undefined
    return {
      templateId: 'grid',
      clipped: obj.items.length > 12 || !!obj.truncated,
      props: {
        label: hint.variable,
        rows: rows.length,
        cols: rows[0]!.length,
        cells: rows,
      },
    }
  }
  if (hint.template === 'linked-list') {
    const nodes: { id: string; value: string | number }[] = []
    let ref: string | undefined = value.ref,
      cycleTo: string | undefined
    const seen = new Set<string>()
    while (ref && nodes.length < 10) {
      if (seen.has(ref)) {
        cycleTo = `p${ref}`
        break
      }
      seen.add(ref)
      const fields: Record<string, ValueRef> | undefined =
        step.heap[ref]?.fields
      if (!fields) break
      nodes.push({
        id: `p${ref}`,
        value: cell(fields.value ?? fields.val ?? fields.data) ?? 'None',
      })
      const next: ValueRef | undefined = fields.next
      ref = next && 'ref' in next ? next.ref : undefined
    }
    if (!nodes.length) return undefined
    return {
      templateId: 'linked-list',
      clipped: !!ref && !cycleTo,
      props: {
        label: hint.variable,
        nodes,
        head: nodes[0]!.id,
        ...(cycleTo ? { cycleTo } : {}),
        pointers: pointers
          .flatMap((h) => {
            const v = frame.locals[h.variable]
            return v && 'ref' in v && seen.has(v.ref)
              ? [{ name: h.variable.slice(0, 20), node: `p${v.ref}` }]
              : []
          })
          .slice(0, 4),
      },
    }
  }
  if (hint.template === 'tree') {
    const nodes: {
      id: string
      keys: (string | number)[]
      parent?: string
      side?: 'left' | 'right'
    }[] = []
    const seen = new Set<string>()
    const visit = (ref: string, parent?: string, side?: 'left' | 'right') => {
      if (seen.has(ref) || nodes.length >= 31) return
      const fields = step.heap[ref]?.fields
      if (!fields) return
      seen.add(ref)
      nodes.push({
        id: `p${ref}`,
        keys: [cell(fields.value ?? fields.val ?? fields.data) ?? 'None'],
        ...(parent ? { parent } : {}),
        ...(side ? { side } : {}),
      })
      for (const child of ['left', 'right'] as const) {
        const v = fields[child]
        if (v && 'ref' in v) visit(v.ref, `p${ref}`, child)
      }
    }
    visit(value.ref)
    if (!nodes.length) return undefined
    return {
      templateId: 'tree',
      clipped: nodes.length === 31,
      props: { label: hint.variable, variant: 'binary', nodes },
    }
  }
  return undefined
}
