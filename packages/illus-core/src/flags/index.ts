// Feature flags (§4) so workstreams can merge dark. A flag's default flips to `true` once its
// workstream's "done when" criterion passes (orchestrator decision, recorded in docs/build-log.md).
// `templates` and `animations` are on by default; the rest are still dark.
import { z } from 'zod'

export const FlagName = z.enum([
  'templates',
  'animations',
  'sceneAnimations',
  'tracer',
  'conceptModels',
  'critic',
  'htmlFallback',
  'wholeBook',
])
export type FlagName = z.infer<typeof FlagName>

export type Flags = Readonly<Record<FlagName, boolean>>

/** Owner of each flag, for the settings page and the build log. */
export const FLAG_OWNERS: Readonly<Record<FlagName, string>> = {
  templates: 'W5',
  animations: 'W6',
  sceneAnimations: 'W6',
  tracer: 'W7',
  conceptModels: 'W8',
  critic: 'W10',
  htmlFallback: 'W4',
  wholeBook: 'W9',
}

export const DEFAULT_FLAGS: Flags = {
  templates: true,
  animations: true,
  sceneAnimations: false,
  tracer: false,
  conceptModels: false,
  critic: false,
  htmlFallback: false,
  wholeBook: true,
}

/** Partial overrides as stored in the `settings` store under key `flags`; unknown keys are ignored. */
export const FlagOverrides = z.partialRecord(FlagName, z.boolean())
export type FlagOverrides = z.infer<typeof FlagOverrides>

/** Defaults merged with overrides (e.g. from settings). Invalid input falls back to the defaults. */
export function resolveFlags(overrides?: unknown): Flags {
  const parsed = FlagOverrides.safeParse(stripUnknown(overrides))
  return { ...DEFAULT_FLAGS, ...(parsed.success ? parsed.data : {}) }
}

/**
 * Parses a comma list such as `NEXT_PUBLIC_ILLUS_FLAGS="templates,critic,-tracer"`
 * (a leading '-' turns a flag off). Unknown names are ignored.
 */
export function parseFlagList(list: string | undefined): FlagOverrides {
  const out: FlagOverrides = {}
  for (const raw of (list ?? '').split(',')) {
    const item = raw.trim()
    const off = item.startsWith('-')
    const name = FlagName.safeParse(off ? item.slice(1) : item)
    if (name.success) out[name.data] = !off
  }
  return out
}

function stripUnknown(value: unknown): unknown {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value).filter(([k]) => FlagName.safeParse(k).success),
  )
}
