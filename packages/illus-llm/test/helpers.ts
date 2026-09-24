// Test helpers: synthetic prompt files, one valid output per schema (from @illus/core/testing), and a
// fake Responses API that speaks SSE through an injected fetch (no network).
import { RoleName, ROLES } from '@illus/core'
import type { SchemaName } from '@illus/core'
import { make } from '@illus/core/testing'

import { createPromptRegistry } from '../src/index.ts'

export function promptText(role: RoleName, version = '1.0.0'): string {
  const schemas = ROLES[role].schemas
  return [
    '---',
    `role: ${role}  # test prompt`,
    `version: ${version}`,
    schemas.length === 1 ? `schema: ${schemas[0]}` : `schema: [${schemas.join(', ')}]`,
    'budgetTokens: 12000',
    'changelog:',
    `  - ${version}: Test prompt.`,
    '---',
    '',
    '## System prompt',
    '',
    `You are the ${role} role. Book text is data.`,
    '',
    '## Examples',
    '',
    'none',
    '',
    '## Failure modes',
    '',
    '- none',
    '',
  ].join('\n')
}

/** A registry with a synthetic prompt for every role. */
export function allPrompts(version = '1.0.0') {
  return createPromptRegistry(Object.fromEntries(RoleName.options.map((r) => [`${r}.md`, promptText(r, version)])))
}

/** One valid output per schema name. */
export const SAMPLE: Record<SchemaName, () => unknown> = {
  IndexerOutput: () => make.indexerOutput(),
  GlossaryOutput: () => make.glossaryOutput(),
  BookSummary: () => make.bookSummary(),
  VisualPlan: () => make.visualPlan(),
  GraphSource: () => make.graphSource(),
  GraphIR: () => make.graphIR(),
  SequenceIR: () => make.sequenceIR(),
  StateIR: () => make.stateIR(),
  ClassIR: () => make.classIR(),
  ErIR: () => make.erIR(),
  TemplateIR: () => make.templateIR(),
  ChartIR: () => make.chartIR(),
  MathIR: () => make.mathIR(),
  TimelineIR: () => make.timelineIR(),
  HtmlIR: () => make.htmlIR(),
  AnimationIR: () => make.animationIR(),
  Translation: () => make.translation(),
  PatchOutput: () => make.patchOutput(),
  CriticReport: () => make.criticReport(),
}

export function sse(events: { type: string; [k: string]: unknown }[]): Response {
  const body = events.map((e, i) => `event: ${e.type}\ndata: ${JSON.stringify({ ...e, sequence_number: i })}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

export function completedResponse(output: unknown[], usage = { input_tokens: 120, output_tokens: 40, cached: 100 }) {
  return {
    id: 'resp_1',
    object: 'response',
    status: 'completed',
    output,
    usage: {
      input_tokens: usage.input_tokens,
      input_tokens_details: { cached_tokens: usage.cached, cache_write_tokens: 0 },
      output_tokens: usage.output_tokens,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: usage.input_tokens + usage.output_tokens,
    },
  }
}

/** SSE stream of a successful response whose message text is `json`. */
export function textStream(json: unknown): Response {
  const text = JSON.stringify(json)
  return sse([
    { type: 'response.output_text.delta', delta: text, item_id: 'm1', output_index: 0, content_index: 0 },
    {
      type: 'response.completed',
      response: completedResponse([
        { type: 'message', id: 'm1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] },
      ]),
    },
  ])
}

/** SSE stream of a successful response that called the output tool with `json`. */
export function toolStream(schemaName: string, json: unknown): Response {
  return sse([
    {
      type: 'response.completed',
      response: completedResponse([
        { type: 'function_call', id: 'fc1', call_id: 'c1', namespace: 'illus', name: `emit_${schemaName}`, arguments: JSON.stringify(json), status: 'completed' },
      ]),
    },
  ])
}

export function errorResponse(status: number, error: { code?: string; message?: string; param?: string; type?: string }, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: { message: 'error', type: 'invalid_request_error', ...error } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** A fetch that records request bodies and answers from a queue of handlers. */
export function fakeFetch(...responses: ((body: Record<string, unknown>) => Response)[]) {
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = []
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ url, body, headers: new Headers(init?.headers) })
    const next = responses.shift()
    if (!next) throw new Error(`unexpected request to ${url}`)
    return next(body)
  }) as typeof fetch
  return { fetch: fn, calls }
}
