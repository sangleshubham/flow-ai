import { RawTrace } from '@illus/core'
import type { TraceStep } from '@illus/core'

export const MAX_TRACE_STEPS = 300
export const MAX_TRACE_BYTES = 2 * 1024 * 1024
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length
const signature = (s: TraceStep) =>
  `${s.event}:${s.pyLine}:${s.frames.map((f) => f.fn).join('/')}`

function sourceLoops(steps: TraceStep[], python: string): TraceStep[] {
  const lines = python.split('\n')
  const loops = new Map<number, number>()
  lines.forEach((line, i) => {
    if (!/^\s*(for|while)\s/.test(line)) return
    const indent = line.length - line.trimStart().length
    let end = i + 1
    while (
      end < lines.length &&
      (!lines[end]!.trim() ||
        lines[end]!.trimStart().startsWith('#') ||
        lines[end]!.length - lines[end]!.trimStart().length > indent)
    )
      end++
    loops.set(i + 1, end + 1)
  })
  const out: TraceStep[] = []
  for (let i = 0; i < steps.length; i++) {
    const first = steps[i]!,
      endLine = loops.get(first.pyLine),
      stack = first.frames.map((f) => f.fn).join('/')
    if (first.event !== 'line' || endLine === undefined) {
      out.push(first)
      continue
    }
    let end = i + 1
    while (end < steps.length) {
      const s = steps[end]!
      if (
        s.frames.map((f) => f.fn).join('/') === stack &&
        (s.event === 'return' || s.pyLine < first.pyLine || s.pyLine >= endLine)
      )
        break
      end++
    }
    const starts: number[] = []
    for (let j = i; j < end; j++) {
      const s = steps[j]!
      if (
        s.event === 'line' &&
        s.pyLine === first.pyLine &&
        s.frames.map((f) => f.fn).join('/') === stack
      )
        starts.push(j)
    }
    const lastStart = starts.at(-1) ?? i
    const terminal = !steps
      .slice(lastStart + 1, end)
      .some(
        (s) =>
          s.event === 'line' && s.pyLine > first.pyLine && s.pyLine < endLine,
      )
    const iterations = terminal ? starts.slice(0, -1) : starts
    if (iterations.length < 6) {
      out.push(first)
      continue
    }
    const skipStart = iterations[3]!,
      skipEnd = iterations[iterations.length - 2]!
    out.push(
      ...steps.slice(i, skipStart),
      {
        ...steps[skipEnd - 1]!,
        skipped: { iterations: iterations.length - 5 },
      },
      ...steps.slice(skipEnd, end),
    )
    i = end - 1
  }
  return out
}

/** Pure compression. Synthetic snapshots use the last skipped state, never a guessed value. */
export function compressTrace(raw: RawTrace, python?: string): RawTrace {
  const parsed = RawTrace.parse(raw)
  if (parsed.error) parsed.error = parsed.error.slice(0, 8192)
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
  const candidate = python ? sourceLoops(recursive, python) : recursive
  const loops: TraceStep[] = []
  for (let i = 0; i < candidate.length; ) {
    let found = false
    // Repeated line-event sequences on the same stack are complete loop iterations. Do not merge
    // calls, returns or exceptions: their control-flow boundaries must stay inspectable.
    for (
      let width = 1;
      width <= 40 && i + width * 6 <= candidate.length;
      width++
    ) {
      const pattern = candidate.slice(i, i + width)
      if (pattern.some((s) => s.event !== 'line' || s.skipped)) continue
      let count = 1
      while (
        i + (count + 1) * width <= candidate.length &&
        pattern.every(
          (s, k) =>
            signature(s) === signature(candidate[i + count * width + k]!),
        )
      )
        count++
      if (count < 6) continue
      loops.push(...candidate.slice(i, i + 3 * width))
      const lastSkipped = candidate[i + (count - 2) * width - 1]!
      loops.push({ ...lastSkipped, skipped: { iterations: count - 5 } })
      loops.push(...candidate.slice(i + (count - 2) * width, i + count * width))
      i += count * width
      found = true
      break
    }
    if (!found) loops.push(candidate[i++]!)
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
      origLines: s.origLines.slice(0, 120),
      stdout: s.stdout.slice(0, 4096),
      exception: s.exception?.slice(0, 2048),
      ...(s.returnValue && 'ref' in s.returnValue
        ? { returnValue: { prim: '[snapshot exceeded byte limit]' } }
        : s.returnValue && typeof s.returnValue.prim === 'string'
        ? { returnValue: { prim: s.returnValue.prim.slice(0, 60) } }
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
