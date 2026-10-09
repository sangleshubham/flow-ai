// Template library registry (§10). Owner: W5. The app passes `templateRegistry` to `<VisualView>`, the
// validator and `createIllusServer({ templates })` only while the `templates` flag is on.
import { z } from 'zod'

import type { TemplateId, TemplateIR, TemplateRegistry } from '@illus/core'

import { arrayTemplate } from './array.tsx'
import { hashTableTemplate } from './hash-table.tsx'
import type { W5Template } from './kit.tsx'
import { linkedListTemplate } from './linked-list.tsx'
import { queueTemplate } from './queue.tsx'
import { stackTemplate } from './stack.tsx'
import { treeTemplate } from './tree.tsx'

export type { ContainerItem, InitialFrame, W5Template } from './kit.tsx'
export { TemplateDropError } from './kit.tsx'

/** A template with its props type erased, as the registry holds it. */
export type AnyTemplate = W5Template<unknown, unknown>

const ALL = [arrayTemplate, linkedListTemplate, stackTemplate, queueTemplate, hashTableTemplate, treeTemplate] as unknown as AnyTemplate[]

const BY_ID = new Map<TemplateId, AnyTemplate>(ALL.map((t) => [t.id, t]))

export function getTemplate(id: TemplateId): AnyTemplate | undefined {
  return BY_ID.get(id)
}

export function listTemplates(): readonly AnyTemplate[] {
  return ALL
}

export const templateRegistry: TemplateRegistry<AnyTemplate> = { getTemplate, listTemplates }

/** The props schema as JSON Schema (draft 2020-12), for the `extractor.template` prompt. */
export function templateJsonSchema(t: AnyTemplate): Record<string, unknown> {
  return z.toJSONSchema(t.propsSchema) as Record<string, unknown>
}

/** The template's worked example as a full `TemplateIR`. */
export function exampleIR(t: AnyTemplate): TemplateIR {
  return { type: 'template', templateId: t.id, props: t.example, evidence: t.exampleEvidence }
}

/** The registry entry as the `extractor.template` prompt shows it: docs, JSON Schema and worked example. */
export function templateDoc(id: TemplateId): string {
  const t = getTemplate(id)
  if (!t) throw new Error(`unknown template ${id}`)
  return [
    `## Template \`${t.id}\``,
    t.description,
    `When to use: ${t.whenToUse}`,
    `Evidence paths: ${t.evidencePaths}`,
    `Animation targets: ${t.targetsDoc}`,
    `Animation actions: ${t.supportedActions.join(', ')}.`,
    'Props JSON Schema:',
    '```json',
    JSON.stringify(templateJsonSchema(t)),
    '```',
    'Worked example (TemplateIR):',
    '```json',
    JSON.stringify(exampleIR(t), null, 1),
    '```',
  ].join('\n')
}
