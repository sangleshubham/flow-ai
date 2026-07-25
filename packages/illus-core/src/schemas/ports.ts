// Interfaces other workstreams implement (§20 "Contracts each workstream publishes"). Consumers depend
// on these types and inject implementations, so nobody imports another workstream's unfinished code.
import { z } from 'zod'

import type { ActionOp } from './animation.ts'
import type { Block } from './book.ts'
import type { Evidence, ReasoningEffort } from './common.ts'
import type { LlmImage, LlmUsage, RoleName, RoleSchemaName, SchemaOutput } from './llm.ts'
import type { TemplateId, VisualKind } from './plan.ts'
import type { ValidationReport } from './quality.ts'
import type { ScenarioTrace, Translation } from './trace.ts'

// ---------------------------------------------------------------- LLM client (W2)

/** Packed context for one call: `prefix` is stable and cacheable, `body` is per call (§7). */
export interface LlmContext {
  prefix: string
  body: string
}

export interface LlmCallOptions<S> {
  /** Which of the role's schemas to request; defaults to the role's first schema. */
  schemaName?: S
  /** Required with `schemaName: 'TemplateIR'`. */
  templateId?: TemplateId
  image?: LlmImage
  escalate?: boolean
  /** On abort the request is dropped client-side and nothing is cached (§9). */
  signal?: AbortSignal
  requestId?: string
  /** For the `llmLog` row. */
  bookId?: string
  sectionId?: string
}

export interface LlmResult<T> {
  data: T
  model: string
  effort: ReasoningEffort
  promptVersion: string
  usage: LlmUsage
  latencyMs: number
  requestId: string
}

/**
 * Typed model call (§9 client). Rejects with `LlmError` (`plan-limit`, `signin-required`, `schema`, …).
 * Implemented by `@illus/llm`; replay mode serves fixtures only.
 */
export interface LlmCall {
  call<R extends RoleName, S extends RoleSchemaName<R> = RoleSchemaName<R>>(
    role: R,
    ctx: LlmContext,
    opts?: LlmCallOptions<S>,
  ): Promise<LlmResult<SchemaOutput<S>>>
}

// ---------------------------------------------------------------- reader bridge (W9)

/** Theme tokens derived from Flow's active theme, exposed as `--illus-*` CSS variables (§10). */
export const ThemeTokens = z.object({
  bg: z.string(),
  fg: z.string(),
  muted: z.string(),
  line: z.string(),
  accent: z.string(),
  new: z.string(),
  earlier: z.string(),
  highlight: z.string(),
  font: z.string(),
  mono: z.string(),
  dark: z.boolean(),
})
export type ThemeTokens = z.infer<typeof ThemeTokens>

/** CSS variable name of each colour/font token. */
export const THEME_TOKEN_VARS = {
  bg: '--illus-bg',
  fg: '--illus-fg',
  muted: '--illus-muted',
  line: '--illus-line',
  accent: '--illus-accent',
  new: '--illus-new',
  earlier: '--illus-earlier',
  highlight: '--illus-highlight',
  font: '--illus-font',
  mono: '--illus-mono',
} as const

export interface HighlightHandle {
  remove(): void
}

export interface ReaderLocation {
  bookId: string
  cfi: string
  sectionId: string | null
}

export interface ReaderSelection {
  cfiRange: string
  text: string
  blockIds: string[]
}

/** All contact with Flow and epub.js (§14). Implemented by `@illus/reader-bridge`. */
export interface ReaderBridge {
  onLocationChange(cb: (loc: ReaderLocation) => void): () => void
  scrollTo(cfi: string): Promise<void>
  highlight(cfiRange: string, kind: 'evidence' | 'step'): HighlightHandle
  clearHighlights(kind?: 'evidence' | 'step'): void
  quoteToCfi(blockId: string, quote: string): Promise<string | null>
  onSelection(cb: (sel: ReaderSelection) => void): () => void
  getTheme(): ThemeTokens
  onThemeChange(cb: (t: ThemeTokens) => void): () => void
}

// ---------------------------------------------------------------- tracer (W7)

export interface TraceRunInput {
  codeBlockId: string
  translation: Translation
}

/**
 * Runs every scenario of a translation in the locked-down Pyodide worker and returns compressed traces
 * (§12). Implemented by `@illus/tracer` (`runTrace`).
 */
export interface TraceRunner {
  runTrace(input: TraceRunInput, opts?: { signal?: AbortSignal }): Promise<ScenarioTrace[]>
}

// ---------------------------------------------------------------- grounding and validation (W10)

/** What the matcher may read: only blocks in the context's `usedBlockIds` (§7, §16). */
export interface GroundingContext {
  /** Permitted blocks by id. */
  blocks: ReadonlyMap<string, Block>
  /** Label of the element the quote justifies, for the relevance check (§16 step 7). */
  label?: string
  /** Glossary aliases of the label. */
  aliases?: readonly string[]
}

export type GroundingStatus = 'grounded' | 'half-grounded' | 'failed'

export interface GroundingResult {
  status: GroundingStatus
  /** Evidence with corrected `blockId`, `start`/`end` and `fuzzy`; absent when `failed`. */
  evidence?: Evidence
  reason?: string
}

/** The grounding matcher (§16). Pure and synchronous. Implemented by `ground()` in `@illus/core/grounding`. */
export type GroundingFn = (evidence: Evidence, ctx: GroundingContext) => GroundingResult

export interface ValidationContext {
  blocks: ReadonlyMap<string, Block>
  ground: GroundingFn
  /** Canonical name → aliases, for the relevance check. */
  aliases?: ReadonlyMap<string, readonly string[]>
  /** Template registry, for `template` IRs. */
  templates?: TemplateRegistry
}

export interface ValidationResult<T = unknown> {
  /** The IR after dropping ungrounded/dangling elements and safe auto-fixes. */
  ir: T
  report: ValidationReport
}

/** Schema + grounding + structural checks for one IR (§16 L1–L3). Implemented by `validate()` (W10). */
export type Validator = (kind: VisualKind, ir: unknown, ctx: ValidationContext) => ValidationResult

// ---------------------------------------------------------------- templates (W5)

/**
 * The DOM-free part of a template (§10). `@illus/render` extends it with `layout(props)` and the React
 * `Component`.
 */
export interface TemplateSpec<P = unknown> {
  id: TemplateId
  description: string
  whenToUse: string
  propsSchema: z.ZodType<P>
  example: P
  supportedActions: readonly ActionOp[]
  /** Semantic invariants (BST order, heap order, pointers in range…); returns violation messages. */
  checkInvariants?(props: P): string[]
}

export interface TemplateRegistry<T extends TemplateSpec = TemplateSpec> {
  getTemplate(id: TemplateId): T | undefined
  listTemplates(): readonly T[]
}

// ---------------------------------------------------------------- layout (W4)

export interface LayoutPoint {
  x: number
  y: number
}

export interface LayoutGraphInput {
  algorithm: 'layered' | 'stress'
  direction: 'LR' | 'TB'
  nodes: { id: string; width: number; height: number; parent?: string }[]
  edges: { id: string; from: string; to: string; label?: { width: number; height: number } }[]
  /** Previous positions; when given, ELK runs in interactive mode so unchanged nodes stay put (§11, §13). */
  hints?: Readonly<Record<string, LayoutPoint>>
}

export interface LayoutGraphResult {
  width: number
  height: number
  nodes: Record<string, LayoutPoint & { width: number; height: number }>
  edges: Record<string, { points: LayoutPoint[]; label?: LayoutPoint }>
}

/** ELK layout in a Web Worker (§10). Implemented by `layoutGraph()` in `@illus/render`. */
export type LayoutGraphFn = (input: LayoutGraphInput, opts?: { signal?: AbortSignal }) => Promise<LayoutGraphResult>
