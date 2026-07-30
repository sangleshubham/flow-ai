// Prompt registry (§9 "Prompt files", docs/prompts/README.md). Parses `docs/prompts/<role>.md`: YAML
// front matter (role, version, schema, budgetTokens, changelog) and the three body sections. Mechanics
// only: prompt content belongs to each role's owner. The app imports the files as raw text at build time.
import { RoleName, SchemaName, roleAllowsSchema } from '@illus/core'

export interface PromptFile {
  role: RoleName
  version: string
  schemas: SchemaName[]
  budgetTokens: number
  changelog: string[]
  /** Sent as `instructions`, before the cached book prefix (§9 step 5). */
  systemPrompt: string
  examples: string
  failureModes: string
}

export interface PromptRegistry {
  /** Throws when the role has no prompt file. */
  get(role: RoleName): PromptFile
  has(role: RoleName): boolean
  roles(): RoleName[]
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** Parses one prompt file. `role` is the role implied by the file name; it must match the front matter. */
export function parsePromptFile(text: string, role?: RoleName): PromptFile {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^﻿/, ''))
  if (!m) throw new Error(`prompt ${role ?? '?'}: missing YAML front matter`)
  const fm = parseFrontMatter(m[1]!)
  const where = `prompt ${role ?? fm.role ?? '?'}`
  const parsedRole = RoleName.safeParse(fm.role)
  if (!parsedRole.success) throw new Error(`${where}: front matter role ${JSON.stringify(fm.role)} is not a RoleName`)
  if (role && parsedRole.data !== role) throw new Error(`${where}: front matter role ${parsedRole.data} does not match the file name`)
  if (typeof fm.version !== 'string' || !SEMVER.test(fm.version)) throw new Error(`${where}: version must be semver`)
  const schemaList = Array.isArray(fm.schema) ? fm.schema : [fm.schema]
  const schemas = schemaList.map((s) => {
    const parsed = SchemaName.safeParse(s)
    if (!parsed.success) throw new Error(`${where}: schema ${JSON.stringify(s)} is not a SchemaName`)
    if (!roleAllowsSchema(parsedRole.data, parsed.data)) throw new Error(`${where}: schema ${parsed.data} is not allowed for the role`)
    return parsed.data
  })
  const budgetTokens = Number(fm.budgetTokens)
  if (!Number.isInteger(budgetTokens) || budgetTokens <= 0) throw new Error(`${where}: budgetTokens must be a positive integer`)
  const changelog = Array.isArray(fm.changelog) ? fm.changelog : []
  if (!changelog.length) throw new Error(`${where}: changelog is required`)
  const sections = splitSections(m[2]!)
  const systemPrompt = sections.get('system prompt')
  if (!systemPrompt) throw new Error(`${where}: missing "## System prompt" section`)
  return {
    role: parsedRole.data,
    version: fm.version,
    schemas,
    budgetTokens,
    changelog,
    systemPrompt,
    examples: sections.get('examples') ?? '',
    failureModes: sections.get('failure modes') ?? '',
  }
}

/**
 * Registry from raw files keyed by file name (`planner.md`) or role. Files whose name is not a role
 * (e.g. `README.md`) are ignored; invalid prompt files throw at construction so errors surface early.
 */
export function createPromptRegistry(files: Record<string, string>): PromptRegistry {
  const prompts = new Map<RoleName, PromptFile>()
  for (const [name, text] of Object.entries(files)) {
    const role = RoleName.safeParse(name.replace(/^.*\//, '').replace(/\.md$/, ''))
    if (role.success) prompts.set(role.data, parsePromptFile(text, role.data))
  }
  return {
    get(role) {
      const p = prompts.get(role)
      if (!p) throw new Error(`no prompt file docs/prompts/${role}.md`)
      return p
    },
    has: (role) => prompts.has(role),
    roles: () => [...prompts.keys()],
  }
}

type Fm = Record<string, string | string[] | undefined>

/** The small YAML subset the front matter uses: `key: scalar`, `key: [a, b]` and `key:` + `- item` lists. */
function parseFrontMatter(src: string): Fm {
  const out: Fm = {}
  let list: string[] | undefined
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '')
    if (!line.trim()) continue
    const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line)
    if (item && list) {
      list.push(unquote(item[1]!.trim()))
      continue
    }
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (!kv) throw new Error(`front matter: cannot parse line ${JSON.stringify(raw)}`)
    const [, key, value] = kv as unknown as [string, string, string]
    if (value === '') out[key] = list = []
    else {
      list = undefined
      const inline = /^\[(.*)\]$/.exec(value)
      out[key] = inline ? inline[1]!.split(',').map((s) => unquote(s.trim())).filter(Boolean) : unquote(value)
    }
  }
  return out
}

function unquote(s: string): string {
  return /^(['"]).*\1$/.test(s) ? s.slice(1, -1) : s
}

function splitSections(body: string): Map<string, string> {
  const out = new Map<string, string>()
  const parts = body.split(/^##\s+(.+)$/m)
  for (let i = 1; i < parts.length; i += 2) out.set(parts[i]!.trim().toLowerCase(), parts[i + 1]!.trim())
  return out
}
