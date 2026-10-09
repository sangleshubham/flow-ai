import { readFileSync } from 'node:fs'
import { loadPyodide } from 'pyodide'
import { beforeAll, describe, expect, it } from 'vitest'
import { RawTrace, Translation } from '@illus/core'

let runtime: Awaited<ReturnType<typeof loadPyodide>>
const source = readFileSync(
  new URL('../src/tracer.py', import.meta.url),
  'utf8',
)
async function run(
  python: string,
  entry: string,
  focusFunctions: string[] = [],
) {
  const payload = JSON.stringify({ python, entry, focusFunctions })
  runtime.globals.set('_request_json', payload)
  return RawTrace.parse(
    JSON.parse(runtime.runPython('_trace_json(_request_json)')),
  )
}
beforeAll(async () => {
  runtime = await loadPyodide()
  runtime.runPython(source)
}, 60_000)

describe('real Pyodide trace', () => {
  it.each(['binary-search', 'merge-sort', 'bfs', 'dp-table', 'recursion'])(
    'executes %s fixture with expected return',
    async (name) => {
      const fixture = JSON.parse(
        readFileSync(
          new URL(`../../../fixtures/traces/${name}.json`, import.meta.url),
          'utf8',
        ),
      )
      const raw = await run(
        fixture.python,
        fixture.entry,
        fixture.focusFunctions,
      )
      expect(raw.error).toBeUndefined()
      expect(raw.steps.length).toBeGreaterThan(0)
      const returned = raw.steps.findLast(
        (s) => s.event === 'return' && s.frames.length === 1,
      )?.returnValue
      if (returned && 'ref' in returned) {
        const last = raw.steps.findLast((s) => s.returnValue === returned)!
        expect(
          last.heap[returned.ref]?.items?.map((v) =>
            'prim' in v ? v.prim : null,
          ),
        ).toEqual(fixture.expected)
      } else expect(returned).toEqual({ prim: fixture.expected })
    },
  )
  it.each([
    'import js\njs.fetch("https://example.invalid")',
    'import pyodide_js',
    'import micropip',
    'import urllib.request',
    'import os\nos.listdir("/")',
    'open("/tmp/persist", "w")',
    'eval("1+1")',
    'getattr(1, "__class__")',
    'x = (1).__class__.__mro__',
    'import random\nx = random._os',
    'try:\n  1/0\nexcept Exception as e:\n  x = e.__traceback__.tb_frame.f_globals',
  ])('rejects imports, IO and reflective escape: %s', async (python) => {
    expect((await run(python, '0')).error).toMatch(/not allowed|blocked/)
  })
  it('locks the JS bridge modules themselves', () => {
    expect(runtime.runPython('__import__("sys").modules["js"] is None')).toBe(
      true,
    )
    expect(
      runtime.runPython('__import__("sys").modules["pyodide_js"] is None'),
    ).toBe(true)
    expect(runtime.runPython('"micropip" in __import__("sys").modules')).toBe(
      false,
    )
  })
  it.each(['translator', 'trace-fixer'])(
    'validates and executes the %s worked examples',
    async (role) => {
      for (const name of ['go-binary-search', 'c-linked-list']) {
        const fixture = JSON.parse(
          readFileSync(
            new URL(
              `../../../fixtures/llm/${role}/handwritten-${name}.json`,
              import.meta.url,
            ),
            'utf8',
          ),
        )
        expect(fixture.source).toBe('handwritten')
        const translation = Translation.parse(fixture.data)
        const raw = await run(
          translation.python,
          translation.scenarios[0]!.entry,
          translation.focusFunctions,
        )
        expect(raw.error).toBeUndefined()
        const last = raw.steps.at(-1)!
        if (name === 'go-binary-search')
          expect(last.returnValue).toEqual({ prim: 3 })
        else {
          const ref = last.returnValue!
          expect('ref' in ref && last.heap[ref.ref]?.fields?.value).toEqual({
            prim: 3,
          })
        }
      }
    },
  )
  it('rejects indirect module access and mutation between runs', async () => {
    for (const code of [
      'import typing\ntyping.sys.modules["os"].system("escape")',
      'import math\nmath.sqrt = len',
    ])
      expect((await run(code, '0')).error).toContain('not allowed')
    expect(
      (
        await run('import math\ndef f():\n  return math.sqrt(4)', 'f()', ['f'])
      ).steps.at(-1)?.returnValue,
    ).toEqual({ prim: 2 })
  })
  it('supports dataclasses while keeping their implementation modules inaccessible', async () => {
    const raw = await run(
      'from dataclasses import dataclass\n@dataclass\nclass Node:\n  value: int\ndef f():\n  n = Node(3)\n  return n.value',
      'f()',
      ['f'],
    )
    expect(raw.error).toBeUndefined()
    expect(raw.steps.at(-1)?.returnValue).toEqual({ prim: 3 })
  })
  it('enforces container/depth/string limits and preserves alias identity', async () => {
    const raw = await run(
      'def f():\n  a = list(range(80))\n  text = "x"*100\n  nested = [[[[[1]]]]]\n  b = a\n  return 0',
      'f()',
      ['f'],
    )
    const last = raw.steps.at(-1)!,
      locals = last.frames[0]!.locals
    expect(locals.text).toEqual({ prim: 'x'.repeat(60) })
    expect(locals.a).toEqual(locals.b)
    const ref = locals.a!
    expect('ref' in ref && last.heap[ref.ref]?.items).toHaveLength(50)
    expect('ref' in ref && last.heap[ref.ref]?.truncated).toBe(true)
    expect(Object.values(last.heap).some((o) => o.truncated)).toBe(true)
  })
  it('uses fresh globals, deterministic random, bounded strings and aliases', async () => {
    const first = await run(
      'import random\ndef f():\n  a = ["x"*100]\n  b = a\n  print("y"*5000)\n  return random.randint(0, 100)',
      'f()',
      ['f'],
    )
    const second = await run(
      'import random\ndef f():\n  return random.randint(0, 100)',
      'f()',
      ['f'],
    )
    expect(first.steps.at(-1)?.returnValue).toEqual(
      second.steps.at(-1)?.returnValue,
    )
    const last = first.steps.at(-1)!
    expect(last.frames[0]?.locals.a).toEqual(last.frames[0]?.locals.b)
    expect(new TextEncoder().encode(last.stdout).length).toBeLessThanOrEqual(
      4096,
    )
    expect(await run('x = 3', 'x')).not.toHaveProperty('error')
    expect((await run('', 'x')).error).toMatch(/NameError/)
  })
  it('stops at 1000 executed line events', async () => {
    const raw = await run('def f():\n  while True:\n    pass', 'f()', ['f'])
    expect(raw.truncated).toBe(true)
    expect(
      raw.steps.filter((s) => s.event === 'line').length,
    ).toBeLessThanOrEqual(1000)
  })
  it('steps over helper functions while showing focused frames and exceptions', async () => {
    const raw = await run(
      'def helper(x):\n  return x+1\ndef f():\n  a = helper(2)\n  return 1/0',
      'f()',
      ['f'],
    )
    expect(
      raw.steps.some(
        (s) => s.event === 'line' && s.frames.at(-1)?.fn === 'helper',
      ),
    ).toBe(false)
    expect(raw.error).toContain('ZeroDivisionError')
    expect(raw.error).toContain('<user>')
  })
})
