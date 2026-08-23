// @vitest-environment node
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'

// These factories fail if the public template entry accidentally imports the renderer barrel.
vi.mock('../src/VisualView.tsx', () => { throw new Error('server templates loaded VisualView') })
vi.mock('../src/mermaid/render.ts', () => { throw new Error('server templates loaded Mermaid renderer') })
vi.mock('../src/graph/layout.worker.ts', () => { throw new Error('server templates loaded layout worker') })
vi.mock('vega', () => { throw new Error('server templates loaded Vega') })
vi.mock('vega-embed', () => { throw new Error('server templates loaded Vega Embed') })
vi.mock('mermaid', () => { throw new Error('server templates loaded Mermaid') })

afterEach(() => vi.unstubAllGlobals())

describe('public server template entry', () => {
  it('resolves for the reader legacy Node resolver and exports-aware consumers', () => {
    // Emulate a workspace consumer link so the test does not depend on W9 adding the app dependency.
    const consumer = fileURLToPath(new URL('./consumer/template-entry-probe.ts', import.meta.url))
    const packageRoot = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
    const entry = fileURLToPath(new URL('../templates.ts', import.meta.url))
    const linked = (path: string) => path.replace(/^.*\/node_modules\/@illus\/render(?=\/|$)/, packageRoot)
    const host: ts.ModuleResolutionHost = {
      fileExists: (path) => ts.sys.fileExists(linked(path)),
      readFile: (path) => ts.sys.readFile(linked(path)),
      directoryExists: (path) => path.endsWith('/node_modules/@illus') || ts.sys.directoryExists(linked(path)),
      realpath: (path) => ts.sys.realpath?.(linked(path)) ?? linked(path),
    }
    for (const moduleResolution of [ts.ModuleResolutionKind.Node10, ts.ModuleResolutionKind.Bundler]) {
      const result = ts.resolveModuleName('@illus/render/templates', consumer, { moduleResolution }, host)
      expect(result.resolvedModule?.resolvedFileName).toBe(entry)
    }
  })

  it('imports and validates all templates under Node without browser globals or renderer engines', async () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
    // Node 24 exposes a non-DOM navigator; remove it too to test the minimal server environment.
    vi.stubGlobal('navigator', undefined)
    const worker = vi.fn(() => { throw new Error('server templates constructed a worker') })
    vi.stubGlobal('Worker', worker)
    const { templateRegistry, exampleIR, templateJsonSchema } = await import('@illus/render/templates')
    const templates = templateRegistry.listTemplates()
    expect(templates).toHaveLength(16)
    for (const template of templates) {
      expect(templateRegistry.getTemplate(template.id)).toBe(template)
      const ir = exampleIR(template)
      const props = template.propsSchema.parse(ir.props)
      expect(template.checkInvariants?.(props)).toEqual([])
      expect(template.propsSchema.safeParse({}).success).toBe(false)
      expect(templateJsonSchema(template).type).toBe('object')
    }
    expect(worker).not.toHaveBeenCalled()
  })

  it('retains semantic validation rather than accepting only the TemplateIR envelope', async () => {
    const { getTemplate } = await import('@illus/render/templates')
    const template = getTemplate('graph-ds')!
    const props = template.propsSchema.parse({
      directed: true, weighted: false,
      nodes: [{ id: 'a', label: 'A' }],
      edges: [{ id: 'ab', from: 'a', to: 'missing' }],
    })
    expect(template.checkInvariants?.(props)).toContain('edge ab: node missing does not exist')
  })
})
