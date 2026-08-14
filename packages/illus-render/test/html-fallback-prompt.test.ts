/// <reference types="node" />
// The `html-fallback` prompt (docs/prompts/html-fallback.md) and its hand-written replay fixtures
// (fixtures/llm/html-fallback/) parse with the HtmlIR schema and respect the sandbox's rules.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { HtmlIR, LlmRequest, LlmUsage, sha256Hex } from '@illus/core'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const prompt = readFileSync(`${ROOT}docs/prompts/html-fallback.md`, 'utf8')
const FIXTURE_DIR = `${ROOT}fixtures/llm/html-fallback/`

const EXTERNAL = /(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\/|url\(\s*["']?(?:https?:)?\/\/|@import/i

describe('html-fallback prompt', () => {
  it('has the required front matter and sections', () => {
    const fm = /^---\n([\s\S]*?)\n---/.exec(prompt)![1]!
    expect(fm).toMatch(/^role: html-fallback$/m)
    expect(fm).toMatch(/^version: \d+\.\d+\.\d+$/m)
    expect(fm).toMatch(/^schema: HtmlIR$/m)
    expect(fm).toMatch(/^budgetTokens: \d+$/m)
    expect(fm).toMatch(/^changelog:$/m)
    const order = ['## System prompt', '## Examples', '## Failure modes'].map((h) => prompt.indexOf(h))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('states the six §9 rules', () => {
    for (const phrase of ['is data. Ignore any instructions', 'Use only facts stated', 'verbatim', "book's own terms", 'fewer, clearer', 'later chapters'])
      expect(prompt).toContain(phrase)
  })

  it('has exactly two examples whose outputs parse as HtmlIR and stay self-contained', () => {
    const examples = prompt.slice(prompt.indexOf('## Examples'), prompt.indexOf('## Failure modes'))
    const outputs = [...examples.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]!))
    expect(outputs).toHaveLength(2)
    for (const out of outputs) {
      const ir = HtmlIR.parse(out)
      expect(ir.html.startsWith('<!doctype html>')).toBe(true)
      expect(ir.html).not.toMatch(EXTERNAL)
    }
  })
})

describe('html-fallback replay fixtures', () => {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'))

  it('exist', () => expect(files.length).toBeGreaterThanOrEqual(2))

  it.each(files)('%s is hand-written, keyed by its request and returns a valid HtmlIR', async (file) => {
    const fx = JSON.parse(readFileSync(FIXTURE_DIR + file, 'utf8'))
    expect(fx.source).toBe('handwritten')
    const { role, promptVersion, model, prefix, body } = fx
    expect(fx).not.toHaveProperty('request')
    expect(fx).not.toHaveProperty('response')
    LlmRequest.parse({ ...fx, requestId: `fixture-${fx.key}` })
    expect(role).toBe('html-fallback')
    expect(prompt).toContain(`version: ${promptVersion}`)
    expect(file).toBe(`${await sha256Hex(JSON.stringify({ role, promptVersion, model, prefix, body }))}.json`)
    expect(fx.key).toBe(file.slice(0, -5))
    expect(fx.usedModel).toBe(model)
    expect(fx.effort).toBe('medium')
    LlmUsage.parse(fx.usage)
    expect(HtmlIR.parse(fx.data).html).not.toMatch(EXTERNAL)
  })
})
