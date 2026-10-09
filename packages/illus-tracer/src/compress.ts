import { RawTrace } from '@illus/core'
import type { TraceStep } from '@illus/core'

export const MAX_TRACE_STEPS = 300
export const MAX_TRACE_BYTES = 2 * 1024 * 1024
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length
const signature = (s: TraceStep) =>
  `${s.event}:${s.pyLine}:${s.frames.map((f) => f.fn).join('/')}`

/** Pure compression. Synthetic snapshots use the last skipped state, never a guessed value. */
export function compressTrace(raw: RawTrace): RawTrace {
  const parsed = RawTrace.parse(raw)
  const recursive: TraceStep[] = []
  for (let i = 0; i < parsed.steps.length; i++) {
    const s = parsed.steps[i]!
    if (s.frames.length <= 4) {
      recursive.push(s)
      continue
    }
    let end = i
    while (parsed.steps[end + 1] && parsed.steps[end + 1]!.frames.length > 4)
      end++
    const last = parsed.steps[end]!
    recursive.push({
      ...last,
      frames: last.frames.slice(0, 4),
      skipped: { iterations: end - i + 1 },
    })
    i = end
  }
  const loops: TraceStep[] = []
  for (let i = 0; i < recursive.length; ) {
    let found = false
    // Repeated line-event sequences on the same stack are complete loop iterations. Do not merge
    // calls, returns or exceptions: their control-flow boundaries must stay inspectable.
    for (
      let width = 1;
      width <= 40 && i + width * 6 <= recursive.length;
      width++
    ) {
      const pattern = recursive.slice(i, i + width)
      if (pattern.some((s) => s.event !== 'line' || s.skipped)) continue
      let count = 1
      while (
        i + (count + 1) * width <= recursive.length &&
        pattern.every(
          (s, k) =>
            signature(s) === signature(recursive[i + count * width + k]!),
        )
      )
        count++
      if (count < 6) continue
      loops.push(...recursive.slice(i, i + 3 * width))
      const lastSkipped = recursive[i + (count - 2) * width - 1]!
      loops.push({ ...lastSkipped, skipped: { iterations: count - 5 } })
      loops.push(...recursive.slice(i + (count - 2) * width, i + count * width))
      i += count * width
      found = true
      break
    }
    if (!found) loops.push(recursive[i++]!)
  }
  let steps = loops
  let truncated = parsed.truncated
  if (steps.length > MAX_TRACE_STEPS) {
    const skipped = steps.length - MAX_TRACE_STEPS + 1
    steps = [
      ...steps.slice(0, 149),
      { ...steps[steps.length - 151]!, skipped: { iterations: skipped } },
      ...steps.slice(-150),
    ]
    truncated = true
  }
  // A single hostile snapshot can be huge. Drop intermediate snapshots until the complete JSON fits.
  // If an individual snapshot still cannot fit, replace it with an explicit truncated boundary.
  while (
    steps.length > 2 &&
    bytes({ ...parsed, steps, truncated }) > MAX_TRACE_BYTES
  ) {
    const half = Math.floor(steps.length / 2)
    steps = [...steps.slice(0, half - 1), ...steps.slice(half + 1)]
    truncated = true
  }
  if (bytes({ ...parsed, steps, truncated }) > MAX_TRACE_BYTES) {
    steps = steps.map((s) => ({
      ...s,
      frames: [],
      heap: {},
      stdout: s.stdout.slice(0, 4096),
      exception: s.exception?.slice(0, 2048),
      ...(s.returnValue && 'ref' in s.returnValue
        ? { returnValue: { prim: '[snapshot exceeded byte limit]' } }
        : {}),
    }))
    truncated = true
  }
  return RawTrace.parse({
    ...parsed,
    steps: steps.map((s, i) => ({ ...s, i })),
    truncated,
  })
}
