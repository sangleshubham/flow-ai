import type { FrameState, Target } from '../schemas/animation.ts'

type Obj = Record<string, unknown>
const object = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Materialises semantic template props for per-frame schema and invariant validation. */
export function projectTemplateFrame(
  props: unknown,
  frame: FrameState,
  templateId: string,
): unknown {
  const base = structuredClone(props) as Obj
  const original = new Map<string, Obj>()
  const collect = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(collect)
    else if (object(v)) {
      if (typeof v.id === 'string') original.set(v.id, v)
      Object.values(v).forEach(collect)
    }
  }
  collect(structuredClone(props))
  const occupant = (target: string) =>
    Object.entries(frame.slots).find(([, s]) => s === target)?.[0] ?? target
  const visit = (v: unknown, path: string): unknown => {
    if (Array.isArray(v))
      return v
        .map((x, i) => {
          const cell = `cell:${path}[${i}]`
          const from = occupant(cell).match(/^cell:(.+)\[(\d+)\]$/)
          const array = from?.[1] === path ? v : undefined
          return (
            frame.values[cell] ??
            visit(array && from ? array[Number(from[2])] : x, `${path}.${i}`)
          )
        })
        .filter((x) => x !== undefined)
    if (!object(v)) return v
    const out = { ...v }
    if (typeof v.id === 'string') {
      const target = `${
        [
          'stack',
          'queue',
          'pipeline',
          'bits',
          'hash-table',
          'set-ops',
        ].includes(templateId)
          ? 'item'
          : 'node'
      }:${v.id}`
      if (
        frame.removed.includes(target as Target) ||
        frame.removed.includes(`item:${v.id}`)
      )
        return undefined
      const source =
        original.get(occupant(target).split(':').slice(1).join(':')) ?? v
      for (const k of ['value', 'keys', 'label'])
        if (k in source) out[k] = structuredClone(source[k])
      const value = frame.values[target] ?? frame.values[`item:${v.id}`]
      if (value !== undefined) {
        if ('keys' in out) out.keys = [value]
        else if (templateId === 'pipeline' && 'stage' in out)
          out.stage = String(value)
        else if (templateId === 'graph-ds') out.distance = value
        else if (templateId === 'cache') out.freq = value
        else if (
          'value' in out ||
          ['bits', 'hash-table', 'cache'].includes(templateId)
        )
          out.value = value
        else if ('label' in out) out.label = String(value)
      }
    }
    for (const [k, x] of Object.entries(out))
      if (Array.isArray(x) || object(x))
        out[k] = visit(x, path ? `${path}.${k}` : k)
    return out
  }
  const projected = visit(base, '') as Obj
  const rows = projected.cells
  if (templateId === 'grid' && Array.isArray(rows))
    projected.cells = rows.map((row, r) =>
      Array.isArray(row)
        ? row.map((v, c) => frame.values[`cell:r${r}[${c}]`] ?? v)
        : row,
    )
  if (frame.containers.stack)
    projected.items = frame.containers.stack.map((x) => ({
      ...x,
      value: frame.values[`item:${x.id}`] ?? x.value,
    }))
  if (frame.containers.queue)
    projected.items = frame.containers.queue.map((x) => ({
      ...x,
      value: frame.values[`item:${x.id}`] ?? x.value,
    }))
  if (frame.containers.frames)
    projected.frames = frame.containers.frames.map(
      (x) =>
        original.get(x.id) ?? { id: x.id, name: String(x.value), vars: [] },
    )
  if (frame.containers.order)
    projected.entries = frame.containers.order.map((x) => ({
      ...original.get(x.id),
      id: x.id,
      key: String(x.value),
      value: frame.values[`item:${x.id}`] ?? original.get(x.id)?.value,
      ...(frame.values[`node:${x.id}`] !== undefined
        ? { freq: frame.values[`node:${x.id}`] }
        : {}),
    }))
  if (templateId === 'array')
    projected.pointers = Object.entries(frame.pointers).map(
      ([name, target]) => ({
        name,
        index: Number(target.match(/\[(\d+)\]$/)?.[1]),
      }),
    )
  if (templateId === 'tree' && Array.isArray(projected.nodes)) {
    for (const a of frame.added)
      if (!frame.removed.includes(`node:${a.id}`)) {
        const siblings = (projected.nodes as Obj[]).filter(
          (n) => n.parent === a.parent,
        )
        const binary = ['binary', 'bst', 'heap-min', 'heap-max'].includes(
          String(projected.variant),
        )
        projected.nodes.push({
          id: a.id,
          keys: [frame.values[`node:${a.id}`] ?? a.label],
          ...(a.parent ? { parent: a.parent } : {}),
          ...(binary
            ? {
                side: siblings.some((n) => n.side === 'left')
                  ? 'right'
                  : 'left',
              }
            : {}),
        })
      }
  }
  if (templateId === 'linked-list' && Array.isArray(projected.nodes)) {
    for (const a of frame.added)
      if (!frame.removed.includes(`node:${a.id}`)) {
        const at = a.parent
          ? (projected.nodes as Obj[]).findIndex((n) => n.id === a.parent) + 1
          : 0
        projected.nodes.splice(at, 0, {
          id: a.id,
          value: frame.values[`node:${a.id}`] ?? a.label,
        })
      }
    for (const [target, value] of Object.entries(frame.values))
      if (
        /^edge:(next|prev)-/.test(target) &&
        value !== 'null' &&
        !(projected.nodes as Obj[]).some((n) => n.id === String(value))
      )
        throw new Error(`relink target ${value} does not exist`)
  }
  if (templateId === 'pipeline' && Array.isArray(projected.items))
    for (const a of frame.added)
      if (!frame.removed.includes(`item:${a.id}`))
        projected.items.push({
          id: a.id,
          label: a.label,
          stage: String(frame.values[`item:${a.id}`] ?? a.parent),
        })
  if (templateId === 'hash-table' && Array.isArray(projected.entries))
    for (const a of frame.added)
      if (!frame.removed.includes(`item:${a.id}`)) {
        const hash = Number(a.parent ?? 0),
          buckets = Number(projected.buckets)
        let slot = hash
        const used = new Set(
          (projected.entries as Obj[]).map((e) => e.slot ?? e.hash),
        )
        if (projected.strategy === 'open-addressing')
          for (let k = 0; k < buckets && used.has(slot); k++)
            slot = (hash + k + 1) % buckets
        projected.entries.push({
          id: a.id,
          key: a.label,
          hash,
          slot,
          value: frame.values[`item:${a.id}`],
        })
      }
  if (templateId === 'memory') {
    for (const [target, value] of Object.entries(frame.values))
      if (target.startsWith('edge:')) {
        const pointer = (projected.pointers as Obj[]).find(
          (p) => p.id === target.slice(5),
        )
        if (pointer) pointer.to = String(value)
      }
    for (const list of [projected.frames, projected.heap])
      if (Array.isArray(list))
        for (const owner of list as Obj[]) {
          const slots = owner.vars ?? owner.fields
          if (Array.isArray(slots))
            for (const slot of slots as Obj[])
              if (frame.values[`item:${owner.id}.${slot.name}`] !== undefined)
                slot.value = frame.values[`item:${owner.id}.${slot.name}`]
        }
  }
  if (
    (templateId === 'stack' || templateId === 'queue') &&
    typeof projected.capacity === 'number' &&
    (projected.items as unknown[]).length > projected.capacity
  )
    throw new Error('container capacity exceeded')
  return projected
}
