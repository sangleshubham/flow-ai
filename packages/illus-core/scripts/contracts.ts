// Regenerates docs/contracts.md (`pnpm contracts`, Node ≥ 24 type stripping). Three parts:
//  1. every exported data type, expanded to its structural TypeScript shape (TypeDoc would only show
//     `z.infer<typeof X>` for Zod-derived types);
//  2. the JSON Schema of every model-output schema, as the gateway sends it;
//  3. the TypeDoc (markdown plugin) reference of the public API: interfaces, functions, constants.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Application } from 'typedoc'
import ts from 'typescript'
import { z } from 'zod'

import { CONTRACTS_VERSION, SCHEMAS } from '../src/index.ts'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = join(PKG, 'src/index.ts')
const OUT = resolve(PKG, '../../docs/contracts.md')
const STATUS = process.env.CONTRACTS_STATUS ?? 'approved by Shubham'

/** Exported type aliases of the entry point, expanded to structural types, grouped by source file. */
function expandedTypes(): string {
  const config = ts.getParsedCommandLineOfConfigFile(join(PKG, 'tsconfig.json'), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    },
  })!
  const program = ts.createProgram([ENTRY], config.options)
  const checker = program.getTypeChecker()
  const printer = ts.createPrinter({ removeComments: false })
  const entry = program.getSourceFile(ENTRY)!
  const flags =
    ts.NodeBuilderFlags.InTypeAlias | ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.MultilineObjectLiterals
  const groups = new Map<string, string[]>()
  for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(entry)!)) {
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    const decl = symbol.declarations?.find(ts.isTypeAliasDeclaration)
    if (!decl || decl.typeParameters) continue
    const node = checker.typeToTypeNode(checker.getDeclaredTypeOfSymbol(symbol), decl, flags)
    if (!node) continue
    const file = decl.getSourceFile()
    const text = printer.printNode(ts.EmitHint.Unspecified, node, file)
    const doc = ts.displayPartsToString(symbol.getDocumentationComment(checker))
    const block = `${doc ? `/** ${doc.replace(/\n/g, ' ')} */\n` : ''}type ${symbol.name} = ${text}`
    const key = file.fileName.slice(PKG.length + 1)
    groups.set(key, [...(groups.get(key) ?? []), block])
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, blocks]) => `### \`${file}\`\n\n\`\`\`ts\n${blocks.join('\n\n')}\n\`\`\``)
    .join('\n\n')
}

function jsonSchemas(): string {
  return Object.entries(SCHEMAS)
    .map(([name, schema]) => {
      const json = JSON.stringify(z.toJSONSchema(schema as z.ZodType, { unrepresentable: 'any' }), null, 2)
      return `### ${name}\n\n<details><summary>JSON Schema</summary>\n\n\`\`\`json\n${json}\n\`\`\`\n\n</details>`
    })
    .join('\n\n')
}

async function typedocReference(): Promise<string> {
  const tmp = mkdtempSync(join(tmpdir(), 'illus-contracts-'))
  try {
    const app = await Application.bootstrapWithPlugins({
      entryPoints: [ENTRY],
      tsconfig: join(PKG, 'tsconfig.json'),
      plugin: ['typedoc-plugin-markdown'],
      out: tmp,
      router: 'module',
      readme: 'none',
      hidePageHeader: true,
      hideBreadcrumbs: true,
      disableSources: true,
      excludePrivate: true,
      excludeInternal: true,
      sort: ['kind', 'alphabetical'],
      useCodeBlocks: true,
      parametersFormat: 'table',
      interfacePropertiesFormat: 'table',
      validation: { notExported: false, invalidLink: false, rewrittenLink: false },
    } as Parameters<typeof Application.bootstrapWithPlugins>[0])
    const project = await app.convert()
    if (!project) throw new Error('TypeDoc conversion failed')
    await app.generateOutputs(project)
    return (readdirSync(tmp, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => readFileSync(join(tmp, f), 'utf8').replace(/^#/gm, '##'))
      .join('\n\n')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Contract history. Each amendment names its ADR; add the newest first. */
const CHANGELOG = `## Changelog

### v1.1 (2026-10-09, [ADR 0008](adr/0008-contracts-v1-1.md))

Additive; every v1.0 producer and consumer stays valid.

- \`TemplateSpec.dropElement?(props, path)\`: optional. Returns props without the element at a \`TemplateEvidence.path\`, so \`validate()\` can drop an ungrounded template element (W5 implements, W10 calls).
- \`VisualRecord.spec\`: for IR kinds it holds \`null\` or the IR again. \`@illus/render\` compiles the validated IR to engine input itself (\`toMermaid\`, \`toVegaLite\`, \`graphLayoutInput\`, …); the graph layout is cached in \`VisualRecord.layout\`. Compilers stay in \`@illus/render\`.
- Spec §10 wording, as amended: **Mermaid ids are aliases** (\`n0\`, \`n1\`, … in IR order) that \`@illus/render\` maps back to IR ids; rendered elements carry \`data-ir-id\` and \`data-target\` with the IR id, never the alias. \`docs/spec.md\` is not edited; this entry and ADR 0008 are the record.
- \`@illus/llm/server\` is a public entry point (lint \`ENTRY_POINTS\`); no other deep import is allowed.
- \`ROLES\` is checked with an identity helper instead of \`satisfies\` (same type); \`satisfies\` is banned in \`@illus\` sources while Next 12's SWC compiles them ([ADR 0009](adr/0009-reader-build-on-typescript-5.md)).
- Deferred to the final gate: Linux visual baselines for \`@illus/render\` and Playwright/renderer e2e in CI. Until then \`pnpm e2e\` runs locally (darwin baselines) and CI runs lint, typecheck, unit tests and \`next build\`.

### v1.0 (2026-10-09, [ADR 0003](adr/0003-contract-decisions.md))

Initial freeze.
`

const doc = `# @illus/core contracts v${CONTRACTS_VERSION.replace(/\.0$/, '')} (${STATUS})

> Generated by \`pnpm contracts\` from \`packages/illus-core\`. Do not edit by hand.
> Deviations from and additions to spec §5 are explained in \`docs/adr/0003-contract-decisions.md\`; later amendments in the changelog below.
> Any change after the freeze needs an ADR and a version bump (spec §4).

1. [Data types](#1-data-types): every exported type, expanded (Zod schemas carry the same name as their type).
2. [Model output schemas](#2-model-output-schemas): JSON Schema of each \`SchemaName\`, with limits.
3. [API reference](#3-api-reference): interfaces, functions and constants (TypeDoc).

Test helpers (\`@illus/core/testing\`) are described in \`packages/illus-core/README.md\`.

${CHANGELOG}
## 1. Data types

${expandedTypes()}

## 2. Model output schemas

Every \`SchemaName\` resolved by \`/api/llm\`. Properties missing from \`required\` are optional.

${jsonSchemas()}

## 3. API reference

${await typedocReference()}
`
writeFileSync(OUT, doc)
console.log(`wrote ${OUT}`)
